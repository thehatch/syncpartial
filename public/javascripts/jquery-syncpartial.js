//sync script
(function( $ ) {

    //setup a global event handler
    $.syncEvents = {};
    _.extend($.syncEvents, Backbone.Events);

    //syncs an html element with the backend socket.io server
    $.fn.syncpartial = function(channel, model, view) {
        if(typeof model == "string") model = eval('(' + model + ')');
        model._view = view;

        //trigger the add event after the html element has been added to the page
        setTimeout(function() {
            $.syncEvents.trigger("element:add", $("#" + model.$id), model);
        }, 10);

        if(!syncPartials[channel]) {
            var SyncPartialList = Backbone.Collection.extend({
                backend : channel,
                model : SyncPartial,
                templates : {},

                initialize: function() {
                    var self = this;

                    this.on("add", function() {
                        var model = this.at(this.length -1);
                        if(typeof model == "string") model = eval('(' + model + ')');
                    });

                    this.bind('backend:update', function(model) {
                        //get the existing data
                        var existing = this.get(model.id);
                        if(!existing) return;

                        //retain the view name from the original model
                        model._view = existing.attributes._view;

                        //update the model with the new data
                        existing.set(model);
                    });
                }
            });

            var list = new SyncPartialList();

            syncPartials[channel] = list;
        }

        model._channel = channel;

        setTimeout(function() {
            //add the model
            syncPartials[channel].add(
                new SyncPartial(model)
            );
        }, 10);

        //add the render template placeholder
        if(!syncTemplates[view]) syncTemplates[view] = null;

        //make sure templates are loaded after page-load
        if(!window.syncTemplatesLoaded) $(document).ready(loadSyncTemplates);

        return this;
    };

    //define the syncpartial class
    window.SyncPartial = Backbone.Model.extend({
        initialize: function() {
            var viewCls = $.syncViews.get(this.attributes._view);
            var el = $("#" + this.attributes.$id);

            this.view = new viewCls({
                model: this,
                id: this.attributes.$id
            });

            this.view.setElement(el);
        }
    });

    //setup the views collection
    $.syncViews = {};

    $.syncViews.get = function(view) {
        var cls = $.syncViews.SyncView;

        if(view.indexOf(".")) view = view.substring(0, view.indexOf("."));

        for(var name in $.syncViews) {
            if(name == view) {
                cls = $.syncViews[name];
                break;
            }
        }

        return cls;
    }

    //define the syncview class
    $.syncViews.SyncView = Backbone.View.extend({

        //init the view and setup event bindings
        initialize: function() {
            this.model.bind('change', this.render, this);
            this.model.bind('destroy', this.remove, this);

            //make sure this.el is set - it might not have existed before the view was rendered
            if(!this.el || this.el.length == 0) this.$el = this.el = $("#" + this.id);
        },

        //(re)renders the view when the model data changes
        render: function() {
            //make sure this.el is set - it might not have existed before the view was rendered
            if(!this.el || this.el.length == 0) this.$el = this.el = $("#" + this.id);

            var templateFn = window.getPartialFn(this.model.attributes._view);

            //don't error if we don't have the template yet
            if(!templateFn) return;

            //cache the current channel
            window.syncChannel = this.model.attributes._channel;

            //generate the html and set on the element
            $(this.el).html(decodeURIComponent(templateFn(this.model.attributes)));

            //make sure this.el is set - it might not have existed before the view was rendered
            if(!this.el || this.el.length == 0) this.$el = this.el = $("#" + this.id);

            //trigger post-render event
            $.syncEvents.trigger("element:render", $(this.el), this.model);

            return this;
        }
    });



})( jQuery );

//instantiate the new partials list with the pageId
var syncPartials = {};
var syncTemplates = {};

//loads the sync templates from the backend
function loadSyncTemplates() {
    //don't load twice
    if(window.syncTemplatesLoaded) return;
    window.syncTemplatesLoaded = true;

    var list = "";
    for(var key in syncTemplates) list += key + ",";
    list = list.substring(0, list.length-1);

    var src = "/syncpartial/templateloader.js?views=" + list;
    var script = $("<script src=\"" + src + "\" type=\"text/javascript\"></script>");

    //load via ajax and process
    $.ajax({
        type: "GET",
        url: src,
        success: null,
        dataType: "script",
        cache: true
    });

    //gets the partial function
    window.getPartialFn = function(view) {
        var fn = window.syncTemplates[view];

        //try without the file extension
        if(!fn && view.indexOf(".") > -1) fn = window.syncTemplates[view.split(".")[0]];

        return fn;
    }

    //set the partial and syncpartial proxy functions
    window.partial = function(view, model) {
        var fn = getPartialFn(view);

        return fn(model);
    }

    window.syncpartial = function(view, model) {
        //sync this model
        $("#" + model.$id).syncpartial(window.syncChannel, model, view);

        //return the new html
        return "<span id=\"" + model.$id + "\">" + window.partial(view, model) + "</span>";
    }
}