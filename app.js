
/**
 * Module dependencies.
 */

var express = require('express')
    , routes = require('./routes')
    , ejs = require('ejs')
    , fs = require('fs')
    , syncpartial = require('./lib/syncpartial');

var app = module.exports = express.createServer();
var server = null;

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', function(req, res) {
    var posts = [];
    for(var i=0; i<4; i++) {
        var post = {};
        post.id = "content:" + i;
        post.title = "post title " + i;
        post.text = "post text " + i;
        post.comments = [];

        for(var c=0; c<4; c++) {
            var comment = {};
            comment.id = post.id + ":" + "comment:" + c;
            comment.text = "blah blah blah " + c;

            post.comments.push(comment);
        }

        posts.push(post);
    }

    res.render("index.ejs",
        {
            posts : posts
        });
});

server = app.listen(3000, function(){
  //console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});


syncpartial.init(app, server);

//demo
setInterval(function() {
    postId++;
    syncpartial.update('page123', { id: 'newpost', post: { id: "content:" + postId, title: 'hello, world', text: 'hello, world ' + new Date() }});
}, parseInt(1000 * 10));

setInterval(function() {
    syncpartial.update('page123', { id: "content:" + postId, title: 'hello, changed world', text: 'hello, world ' + new Date() });
}, parseInt(1000 * 3));

setInterval(function() {
    syncpartial.update('page123', { id: "content:" + parseInt(Math.random() * 5) + ":comment:" + parseInt(Math.random() * 5), text: 'blah blah blah ' + new Date() });
}, parseInt(1000 * 1));

var postId = 5;

/*
var backboneio = require('backbone.io');
var backbones = {};
*/