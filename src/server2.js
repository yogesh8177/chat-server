var cluster = require('cluster');
var redis = require('socket.io-redis');
var sticky = require('socketio-sticky-session');
var http = require('http');
var express = require('express');
var app = express();
var parser = require('body-parser');
var fs = require('fs');
var url = require('url');
var Guid = require('guid');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var assert = require('assert');
var usersOnline = [];
var DB = null;
var private = require('./private-chat');
var group = require('./group-chat');
var globalChat = require('./global-chat');
var userSettings = require('./user_settings');

//Database connection and setup

var url = 'mongodb://localhost:27017/myDB';
MongoClient.connect(url, function(err, db) {
  assert.equal(null, err);
  DB = db;
  module.exports.DB = DB;
  console.log("Connected correctly to server.");
});

	var server = http.createServer(app);
	var io = require('socket.io')(server); //Socket.io listening to server
	//Config
	app.use(express.static(__dirname + '/'));
	app.use(parser.json());
	app.use(parser.urlencoded({extended:true}));

	app.get('/',function(request,response){
		fs.readFile(__dirname+'/index.html', function(error,data){

			if(error){
				response.writeHead(404);
				response.send('Not found');
				response.end();
			}else{
				response.sendFile(__dirname+'/index.html');
			}
		});
		//response.send('Hello world!');
		//response.end();
	});

	app.get('/private',function(request,response){
		fs.readFile(__dirname+'/private.html', function(error,data){

			if(error){
				response.writeHead(404);
				response.send('Not found');
				response.end();
			}else{
				response.sendFile(__dirname+'/private.html');
			}
		});
		
	});

	app.get('/sham', function(request, response){
		response.sendFile(__dirname+'/Sham.html');
	});

	app.get('/group', function(request, response){
		response.sendFile(__dirname+'/group.html');
	});

	app.get('/group-create', function(request, response){
		response.sendFile(__dirname+'/group-create.html');
	});

	app.post('/api/sync_contacts', function(request, response){
		syncContacts(request, response);
	});

	app.get('/api/fetch_contacts',function(request,response){
		fetchContacts(request,response);
	});

	app.get('/register',function(request,response){	
		response.sendFile(__dirname+'/register.html');
	});

	app.post('/api/register',function(request,response){
		registerUser(request, response);		
	});

server.listen(3000,function(){
	console.log('Listening on port 3000');
});



//Listen to server (Socket.io)
io.on('connection', function(socket){
	socket.emit('connected',{data:'connected'});

//Client ack on connection, add client to online user list.
	socket.on('connection-ack', function(msg){
		addOnlineUsers(msg, socket);
	});

	socket.on('disconnect', function(){
		removeOnlineUser(socket); console.log(new Date());
	});

	socket.on('remove-pending', function(msg){
		removeFromPendingQueue(msg._id);console.log('pending removed');
	});

	socket.on('private-typing', function(msg){
		private.typing(socket, msg);
	});
//Add private message to db when it first arrives and send back message id to sender
	socket.on('private-message', function(msg){
		private.addMessage(msg, function(id){
			socket.emit('private-posted',{_id:id, local_id: msg.local_id, datetime: new Date()});
		});
	});
//Send private message to destination
	socket.on('private-id-received', function(msg){
		private.sendMessage(socket, msg);
	});

	socket.on('private-delivered-ack', function(msg){console.log('delivered');
		private.deliveryAck(socket,msg);
	});
//################################   Group   $$$$$$$$$$$$$$$$$$$$$$$$$$$$
	socket.on('group-typing', function(msg){
		group.typing(socket, msg);
	});

	socket.on('group-message', function(msg){
		group.addMessage(msg, function(id){
			socket.emit('group-posted', {_id:id, local_id: msg.local_id, datetime: new Date()});
		});
	});

	socket.on('group-id-received', function(msg){
		group.sendMessage(socket, msg);
	});

	socket.on('group-message-delivery-ack', function(msg){
		group.deliveryAck(socket, msg);
	});

	socket.on('group-create', function(msg){
		group.create(socket, msg);
	});

	socket.on('group-remove', function(msg){
		group.delete(socket, msg);
	});

	socket.on('group-create-id-received-ack', function(msg){
		group.broadcast(socket, msg);console.log('Group created id ack: '+msg.group_id);
	});

	socket.on('add-group-members', function(msg){
		group.addMembers(socket, msg);
	});

	socket.on('remove-group-members', function(msg){
		group.removeMembers(socket, msg);
	});
//############################# Global ##########################################3

	socket.on('global-message', function(msg){
		globalChat.addMessage(msg, function(message){
			socket.emit('global-message-posted', {_id:message._id});
		});
	});

	socket.on('global-message-id-received', function(msg){
		globalChat.sendMessage(socket, msg);
	});

	socket.on('check-user-online', function(msg){
		checkUserOnline(msg._id, function(status){
			socket.emit('user-online-status', {status: status, user_id: msg._id});
		});
	});

	socket.on('status-update', function(msg){
			userSettings.updateUserStatus(socket, msg);
	});

	socket.on('message', function(msg){
		console.log(msg);
		socket.emit('message',{group: msg.group, type: msg.type, body:msg.body});
	});


});

//################################################# Utility Functons ######################################################




//Add user to online list oce connected..
function addOnlineUsers(msg, socket){
	var user = new Object();
		//user.user_id = msg.user_id;
		user.name = msg.name;
		user.mobile = msg.mobile;
		user.token = msg.token;
		user._id = msg._id;
		user.socket_id = socket.id;
	
	authenticateUser(user, function(status){
		if(status === true){
			usersOnline.push(user);
			console.log('authenticated: '+user.name);
			socket.broadcast.emit('user-connected',{user: msg.name});
			socket.emit('authenticated',{datetime: new Date()});
			broadcastUserConnectedStatus(socket, user._id, true);
			syncState(socket, user._id);
		}else{
			socket.broadcast.emit('authentication-failed',{user: msg.name});
			socket.disconnect();
			console.log('Invalid login attempt!');
		}
	});
		

	
}

module.exports.getSocketId = function getSocketId(user_id, callback){

	var found = false;
	for(var i=0; i<usersOnline.length;i++){
		if(usersOnline[i]._id === user_id){
			callback(usersOnline[i].socket_id);
			found = true;
			break;
		}
	}
	if(!found)
		callback(null);
	
	
}

module.exports.getGroupSocketId = function getGroupSocketId(data, callback){
	var socket_ids = [];
	loop1:
	for(var i=0;i<data.length;i++){
		loop2:
		for(var j=0;j<usersOnline.length;j++){
			if(usersOnline[j]._id === data[i].user_id){
				socket_ids.push(usersOnline[j].socket_id);
				//break loop2;
			}
		}
			
	}
	
	callback(socket_ids);
}

function removeOnlineUser(socket){
	console.log('client disconnecting: '+socket.id);

		for(var i=0; i< usersOnline.length; i++){
			if(usersOnline[i].socket_id === socket.id){
				console.log('user disconnected: '+ usersOnline[i].name);
				var removed = usersOnline.splice(i,1); 
				broadcastUserConnectedStatus(socket, removed[0]._id, false);
				break;
			} 
		}
}

function registerUser(user){
  	
	  	var cursor = DB.collection('users').find({mobile: user.mobile});
		cursor.nextObject(function(err, doc){
			assert.equal(err,null);
			if(doc!=null){
				console.log('User already exists');
			}
			else{
				DB.collection('users').insertOne(user);
			}
		});

}

//check if user is authentic!
function authenticateUser(user, callback){

		var cursor = DB.collection('users').find({_id:new ObjectId(user._id), token:user.token});
		cursor.nextObject(function(err, doc){
			//assert(err,null);
			if(doc!=null){
				callback(true);
			}else{
				callback(false);
			}
		});
}

function registerUser(request, response){
	var user = new Object();
		user.name = request.body.username;
		user.email = request.body.email;
		user.mobile = request.body.mobile;
		user.password = request.body.password;
		user.status = "No status";
		user.datetime = new Date();
		user.token = Guid.raw();

		DB.collection('users').insertOne(user, function(err, result){
			if(err){
				response.send("{error:\""+err+"\"}");	
			}else{		
				response.send("{token:\""+user.token+"\", user_id:\""+user._id+"\"}");	
			}		
			
		});
		console.log(user);
}

function syncContacts(request, response){
	DB.collection('users').find({},{name:1}, function(err, cursor){
			cursor.count(function(err,count){
				response.send('{count:'+count+'}');
			});
			
		});
	console.log('Synced: '+new Date());
}

function fetchContacts(request, response){
	var datetime = request.query.datetime;
	var contacts = [];
console.log(datetime);
	if(datetime === undefined || datetime === ''){console.log('datetime undefined');
		DB.collection('users').find({$query:{}, $orderby:{datetime:1}},{name:1, datetime:1, status:1}, function(err, cursor){
			cursor.forEach(function(doc){
				contacts.push(doc); 
			}, function(){
				response.send(contacts);
			});
			
		});

	}else{console.log('datetime here');
		DB.collection('users').find({$query:{datetime: {$gt: new Date(datetime)}}, $orderby:{datetime:1}},{name:1, datetime:1, status:1}, function(err, cursor){
			cursor.forEach(function(doc){
				contacts.push(doc); 
			}, function(){
				response.send(contacts);
			});
		});
	}
}

function checkUserOnline(user_id, callback){
	for(var i=0; i<usersOnline.length; i++){
		if(usersOnline[i]._id === user_id){
			callback(true);
			break;
		}else{
			callback(false);
		}
	}
}

function broadcastUserConnectedStatus(socket, id, status){
	for(var i=0; i<usersOnline.length; i++){	
		socket.broadcast.to(usersOnline[i].socket_id).emit('user-online-status', {status: status, user_id: id});		
	}
}

function syncState(socket, user_id){
	DB.collection('pendingqueue').find({to: user_id}, function(err, cursor){
		cursor.forEach(function(doc){
			switch(doc.category){
				case 'private-message':
					socket.emit('private-message',doc);
				break;

				case 'private-delivery-receipt':
					socket.emit('private-delivery-receipt',doc);
				break;

				case 'group-message':
					socket.emit('group-message',doc);
				break;

				case 'group-delivery-receipt':
					socket.emit('group-delivery-receipt',doc);
				break;

				case 'added-to-group':
					socket.emit('added-to-group',doc);
				break;

				case 'added-to-new-group':
					socket.emit('added-to-new-group',doc);
				break;

				case 'group-members-removed':
					socket.emit('group-members-removed',doc);
				break;

				case 'status-changed':
					socket.emit('status-changed', doc);
				break;
			}
		});
	});
}

function removeFromPendingQueue(id){
	DB.collection('pendingqueue').remove({_id: new ObjectId(id)});
}








