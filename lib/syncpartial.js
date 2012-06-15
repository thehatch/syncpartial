var backboneio = require('backbone.io')
    , fs = require('fs')
    , path = require('path');

var backbones = {};
var viewengines = {};
var cache = {};
var $idPrefix = "_s";

//emits an update event to a model in the specified channel
exports.update = function(channel, model) {
    this.emit(channel, "updated", model);
}

//emit model data to the specified channel
exports.emit = function(channel, event, model) {
    //check for an existing listener
    var backend = backbones[channel];

    //if there is no existing listener, quit
    if(!backend) return;

    //set all $id's
    set$ids(model);

    //should this view be compiled on the server?
    var view = cache[model.id];
    if(view) {
        model.html = renderViewByPath(view, model);
    }

    backbones[channel].emit(event, model);
};

//initialise the syncpartial socket.io server
exports.init = function(app, server) {
    //load the scripts
    var viewengineName = app.get("view engine")
        , viewengine = require(viewengineName);

    //create the partial and syncpartial helper functions
    app.locals.use(function(req, res) {

        //standard partial helper
        res.locals.partial = partial;

        //syncpartial helper
        res.locals.syncpartial = syncpartial;
    });

    partial = function(view, model) {
        var viewengineName = app.get("view engine");
        var viewengine = require(viewengineName);
        var result = null;

        //create an empty model if there is none
        if(!model) model = {};

        //make sure it caches properly
        model.filename = view;
        model.cache = true;

        //reference self
        model.partial = partial;
        model.syncpartial = syncpartial;

        var viewPath = app.settings.views + "/" + view;
        if(!path.extname(viewPath)) viewPath += "." + viewengineName;

        result = renderViewByPath(viewPath, model);

        return result;
    };

    syncpartial = function(view, model, channel) {
        //require a model with a valid id and a channel name
        if(!model.id) throw new Error("id must be defined in the model for a syncpartial");
        if(!channel) throw new Error("channel must be defined for a syncpartial");

        //if we cannot render locally, cache the view for the model.id
        var viewPath = app.settings.views + "/" + view;
        if(!canRenderOnClient(viewPath)) cache[model.id] = viewPath;

        //check for an existing listener
        var backend = backbones[channel];

        //create the listener on the backend
        if(!backend) {
            backend = backboneio.createBackend();
            backend.use(backboneio.middleware.memoryStore());

            var dict = {};
            dict[channel] = backend;

            //start listening for connections
            backbones[channel] = backend;
            backboneio.listen(server, dict);
        }

        model.$id = $idPrefix + model.id.replace(/\:/g, '');

        //generate the front-end javascript wrapper
        var syncScript = "<script> $('#" + model.$id + "').syncpartial('" + channel + "', '" + JSON.stringify(model) + "', '" + view + "'); </script>";

        //return the wrapped html for the syncpartial
        return "<span id='" + model.$id + "'>\n" + this.partial(view, model) + "\n</span>\n" + syncScript;
    };

    //synctemplates loader
    app.get("/syncpartial/templateloader.js", function(req, res) {
        var js = "";
        var views = req.param("views").split(',');

        //stack stops us compiling the same views twice
        stack = {};

        for(var v in views) {
            js += compileView(views[v], stack);
        }

        res.write(js);
        res.end();
    });

    //compiles a view for use on the front-end
    compileView = function(view, stack) {
        //don't compile the same view twice
        if(!stack) stack = {};
        if(stack[view.split(".")[0]]) return "";
        else stack[view.split(".")[0]] = view;

        var viewPath = app.settings.views + "/" + view;
        if(!path.extname(viewPath)) viewPath += "." + app.get("view engine");

        var js = compileViewByPath(viewPath);
        js = js.replace(/\n/g, ' ');
        js = "window.syncTemplates['" + view.split(".")[0] + "']=" + js + ";\n";

        //recurse to include sub-partials
        var partialRegex = /(partial\([\'\"])([^\'\"]*)([\'\"])/g;

        if(partialRegex.test(js)) {
            var matches = js.match(partialRegex);

            for(var i in matches) {
                var match = matches[i].replace(partialRegex, '$2');
                js += compileView(match, stack);
            }
        }

        return js;
    }

    //sets all $id values for the specified object graph
    set$ids = function(model) {
        if(model.id) model.$id = $idPrefix + model.id.replace(/\:/g, '');

        if(typeof model == "object") {
            for(var obj in model) {
                set$ids(model[obj]);
            }
        }
    }

    //works out the view type and compiles to a function
    compileViewByPath = function(viewPath) {
        var viewengineName = path.extname(viewPath).replace(".", "").toLowerCase();
        var viewengine = getViewEngine(viewengineName);

        //view engines that we want to use for syncpartial must be explicitly defined here
        switch(viewengineName) {
            case "ejs":
                return "function(locals) { if(!locals) locals = {}; __stack = {}; " + viewengine.parse(read(viewPath)).toString() + "}";
            case "bliss":
                return viewengine.compile(read(viewPath)).toString();
            case "dust":
                return "function(locals) { return locals.html; }";
            default:
                throw new Error("View engine '" + viewengineName + "' not valid for syncparial");
        }
    }

    //works out the view type and compiles to a function
    renderViewByPath = function(viewPath, model) {
        var viewengineName = path.extname(viewPath).replace(".", "").toLowerCase();
        var viewengine = getViewEngine(viewengineName);

        //try the standard viewengine.__express() extension method
        if(viewengine.__express) {
            var html = "";

            viewengine.__express(viewPath, model, function(err, out) {
                if(err) throw new Error(err);
                html = out;
            });

            return html;
        }

        //engine specific logic
        switch(viewengineName) {
            case "ejs":
                return viewengine.render(read(viewPath), model);
            case "bliss":
                return viewengine.render(viewPath, model);
            case "dust":
                var html = null;

                //don't compile the view twice
                if(!cache[viewPath]) {
                    viewengine.compileFn(read(viewPath), viewPath);
                    cache[viewPath] = true;
                }

                //partial helper function
                model.partial = function(chunk, context, bodies, params) {
                    if(typeof params.model != "object") params.model = { model: params.model };
                    return chunk.write(partial(params.view, params.model));
                }

                //syncpartial helper function
                model.syncpartial = function(chunk, context, bodies, params) {
                    if(typeof params.model != "object") params.model = { model: params.model };
                    return chunk.write(syncpartial(params.view, params.model, params.channel));
                }

                viewengine.render(viewPath, model, function(err, out) {
                    if(err) throw new Error(err);
                    html = out;
                })
                return html;
            default:
                throw new Error("View engine '" + viewengineName + "' not valid for syncparial");
        }
    }

    //gets a viewengine to do some rendering
    getViewEngine = function(viewengineName) {
        //filename extensions mapping to view engines with different names
        if(viewengineName == "js.html") viewengineName = "bliss";

        if(!viewengines[viewengineName]) {
            var viewengine = require(viewengineName);
            if(viewengineName == "bliss") viewengine = new viewengine();
            viewengines[viewengineName] = viewengine;
        }

        return viewengines[viewengineName];
    }

    //gets whether a view can be rendered locally
    canRenderOnClient = function(viewPath) {
        var ext = path.extname(viewPath).replace(".", "");

        switch(ext) {
            case "dust":
                return false;
            default:
                return true;
        }
    }

    //reads a file or gets it from the cache
    read = function(path) {
        if(cache[path]) return cache[path];
        cache[path] = fs.readFileSync(path).toString();
        return cache[path];
    }
};