var cluster = require('cluster');
var redis = require('socket.io-redis');
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
var GLOBAL_MESSAGES = [];
var GLOBAL_HISTORY_SIZE = 20;
var DB = null;


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


app.get('/api/message/get/:user',function(request,response){
	var message = new Object();
	message.group = request.params.user;

	response.send('user is '+message.group);
	response.end();
});

app.post('/api/register/',function(request,response){
	var message = new Object();
	message.group = request.body.group;
	message.type = request.body.type;
	message.body = request.body.content;

	console.log(message);
});

//Start server
server.listen(3000,function(){
	console.log('Listening on port 3000');
});

//Database connection and setup

var url = 'mongodb://localhost:27017/myDB';
MongoClient.connect(url, function(err, db) {
  assert.equal(null, err);
  DB = db;
  console.log("Connected correctly to server.");
});




//Listen to server (Socket.io)
io.on('connection', function(socket){
	socket.emit('connected',{data:'connected'});

//Client ack on connection, add client to online user list.
	socket.on('connection-ack', function(msg){
		addOnlineUsers(msg, socket);
	});

	socket.on('disconnect', function(){
		removeOnlineUser(socket);
	});
//Add private message to db when it first arrives and send back message id to sender
	socket.on('private-message', function(msg){
		addPrivateMessage(msg, function(id){
			socket.emit('private-posted',{_id:id});
		});
	});
//Send private message to destination
	socket.on('private-id-received', function(msg){
		sendPrivateMessage(socket, msg);
	});

	socket.on('private-delivered-ack', function(msg){
		privateDeliveryAck(socket,msg);
	});
//################################   Group   $$$$$$$$$$$$$$$$$$$$$$$$$$$$
	socket.on('group-message', function(msg){
		addGroupMessage(msg, function(id){
			socket.emit('group-posted', {_id:id});
		});
	});

	socket.on('group-id-received', function(msg){
		sendGroupMessage(socket, msg);
	});

	socket.on('group-message-delivery-ack', function(msg){
		groupDeliveryAck(socket, msg);
	});

	socket.on('group-create', function(msg){
		createGroup(socket, msg);
	});

	socket.on('group-remove', function(msg){
		deleteGroup(socket, msg);
	});

	socket.on('group-create-id-received-ack', function(msg){
		broadcastGroupCreated(socket, msg);console.log('Group created id ack: '+msg._id);
	});

	socket.on('add-group-members', function(msg){
		addGroupMembers(socket, msg);
	});

	socket.on('remove-group-members', function(msg){
		removeGroupMembers(socket, msg);
	});
//############################# Global ##########################################3

	socket.on('global-message', function(msg){
		addGlobalMessage(msg, function(message){
			socket.emit('global-message-posted', {_id:message._id});
		});
	});

	socket.on('global-message-id-received', function(msg){
		sendGlobalMessage(socket, msg);
	});



	socket.on('message', function(msg){
		console.log(msg);
		socket.emit('message',{group: msg.group, type: msg.type, body:msg.body});
	});


});

//################################################# Utility Functons ######################################################

function sendPrivateMessage(socket, msg){
			DB.collection('privatemessage').find({_id: new ObjectId(msg._id)}, function(err, cursor){
				cursor.nextObject(function(err, message){
					if(message!=null){
						getSocketId(message.to, function(socket_id){
							if(socket_id != null)
								socket.broadcast.to(socket_id).emit('private-message',{_id: message._id,from: message.from, type: message.type, body: message.body, datetime: message.datetime});
						});					
					}
				});
			});
}

function privateDeliveryAck(socket, msg){
		DB.collection('privatemessage').find({_id: new ObjectId(msg._id)},function(err, cursor){
			cursor.nextObject(function(err, doc){
				if(doc!=null){
					doc.delivered = new Date();
					getSocketId(doc.from, function(socket_id){
						if(socket_id != null){
							socket.broadcast.to(socket_id).emit('private-deliverey-receipt', {_id: doc._id, datetime: doc.delivered});						
						}else{
							console.log('Recipient not online');
							addToPendingDeliveryReport(doc);
						}
					});				
				}
			});
		});
}

function sendGroupMessage(socket, msg){
	
			DB.collection('groupmessage').find({_id:new ObjectId(msg._id)}, function(err, cursor){
				cursor.nextObject(function(err, message){
					DB.collection('groupmessage').find({_id:new ObjectId(message.group_id)}, function(err, cursor){
						cursor.nextObject(function(err, group){
							if(group!=null){
								getGroupSocketId(group.members, function(socket_ids){
									console.log(socket_ids);
									for(var i=0; i<socket_ids.length;i++){
										socket.broadcast.to(socket_ids[i]).emit('group-message', {_id: message._id,from: message.from, type: message.type, body: message.body, datetime: message.datetime});
									}
								});		
							}
									
						});
					});
				});
			});
}
//Delivery acknowlege of group message
function groupDeliveryAck(socket, msg){
		var timeStamp = new Date();
		DB.collection('groupmessage').update({_id: new ObjectId(msg._id)},
		 									{ $push:
		 										{	//update delivery counter
		 											delivered_to: {user_id: msg.user_id, datetime: timeStamp}		 											
		 										},
		 									  $inc: {delivery_counter:-1}
		 									},function(err, cursor){
												//send ack to end users here...
												DB.collection('groupmessage').find({_id: new ObjectId(msg._id)},{from:1, delivered_to:1}, function(err, cursor){
													
													cursor.nextObject(function(err,doc){
														if(doc!= null){
															getSocketId(doc.from, function(socket_id){
																if(socket_id!=null){
																	socket.broadcast.to(socket_id).emit('group-deliverey-receipt', {_id: msg._id, delivered_to: msg.user_id, datetime: timeStamp});
																}else{
																	addToPendingDeliveryReportGroup(doc, timeStamp);
																}
															});
															
														}
													});
												});
											});
}

function sendGlobalMessage(socket, message){
	for(var i=0; i<GLOBAL_MESSAGES.length; i++){
		if(GLOBAL_MESSAGES[i]._id === message._id){
			socket.broadcast.emit('global-message', {_id: message._id, from: message.from, type: message.type, body: message.body, datetime: message.datetime});
			break;
		}
	}
}

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
		}else{
			console.log('Invalid login attempt!');
		}
	});
		

	
}

function getSocketId(user_id, callback){
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

function getGroupSocketId(data, callback){
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
				usersOnline.splice(i,1);
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

//save message to db 
function addPrivateMessage(msg, callback){
	var message = new Object();
	message.from = msg.from;
	message.to = msg.to;
	message.type = msg.type;
	message.body = msg.body;
	message.datetime = new Date();
	message.delivered = [];
	message.read = [];

		DB.collection('privatemessage').insertOne(message, function(err,result){
			//db.close();
			if(err){
				console.log(err);
			}else{
				callback(result.ops[0]._id);
			}
			
		});
}

//add group message when not delivered to all clients
function addGroupMessage(msg, callback){
	var message = new Object();
	message.from = msg.from;
	message.group_id = msg.group_id;
	message.type = msg.type;
	message.body = msg.body;
	message.datetime = new Date();
	message.delivered_to = [];
	message.read_by = [];

//check how many members in a group from group document
		DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{count:1}, function(err, cursor){
			cursor.nextObject(function(err,doc){
			if(doc!=null){
				message.delivery_counter = doc.count <= 0 ? 0 : doc.count - 1;
				console.log('Members')
				DB.collection('groupmessage').insertOne(message, function(err, result){		//insert message after updating delivery_counter (Total members in a group)
					callback(result.ops[0]._id);
					console.log('Added to group message');
				});
			}				
			});
		}); 

}

function addGlobalMessage(msg, callback){
	var message = new Object();
	message.from = msg.from;
	message.type = msg.type;
	message.body = msg.body;
	message.datetime = new Date();

	if(GLOBAL_MESSAGES.length >= GLOBAL_HISTORY_SIZE){
		GLOBAL_MESSAGES.splice(GLOBAL_HISTORY_SIZE,1);
		GLOBAL_MESSAGES.push(message);
		callback(message);
	}else{
		GLOBAL_MESSAGES.push(message);
		callback(message);
	}
	
}

function createGroup(socket, msg){
	var group = new Object();
	group.name = msg.name;
	group.created_at = new Date();
	group.members = msg.members;
	group.count = msg.members.length;

	for(var i=0; i< group.count; i++){
		group.members[i].join_date = new Date();
	}

		DB.collection('groupmessage').insertOne(group, function(err, result){
			socket.emit('group-created', {_id: result.ops[0]._id, datetime: result.ops[0].created_at});
		});
}

function deleteGroup(socket, msg){
	DB.collection('groupmessage').remove({_id: new ObjectId(msg.group_id)}, function(err, result){
		socket.emit('group-deleted',{_id: msg.group_id});
	});
}

function broadcastGroupCreated(socket, msg){
	console.log('broadcast group created');
	DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)}, {members:1, name:1},
		function(err, cursor){
			cursor.nextObject(function(err, doc){
				if(doc!=null){
					for(var i=0; i<doc.members.length; i++){
						getSocketId(doc.members[i].user_id, function(socket_id){
							if(socket_id!=null){
								socket.broadcast.to(socket_id).emit('added-to-group',{group_id: doc._id, name: doc.name, datetime: doc.members[i].join_date});
							}else{
								addToPendingGroupStatusReport({group_id: doc._id, type:'atg', to: doc.members[i].user_id, datetime: doc.members[i].join_date});
							}					
						});
					}
				}
			});
		});
}

//parameter msg contains array of members to add to the group
function addGroupMembers(socket, msg){
	var Members = [];
	for(var i=0; i<msg.members.length; i++){
		var member = new Object();
		member.user_id = msg.members[i].user_id;
		member.join_date = new Date();
		Members.push(member);
	}
		DB.collection('groupmessage').update({_id: new ObjectId(msg.group_id)},
											 {$push: 
											 	{
											 		members: {$each: Members}
											 	},
											  $inc: {count:Members.length},
											  upsert: true
											 },
											 function(err, result){
											 	socket.emit('group-members-added', {_id: msg.group_id}); //Send ack to member who added users to the group
											 	DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{members:1, name: 1},
											 	 function(err, cursor){
											 		cursor.nextObject(function(err, doc){
											 			if(doc!=null){
											 				for(var i=0; i<doc.members.length; i++){  //send ack to members who are added to the group
											 					getSocketId(doc.members[i].user_id, function(socket_id){
											 						if(socket_id != null){
											 							socket.broadcast.to(socket_id).emit('added-to-group', {_id: msg.group_id, name: doc.name, members: Members, datetime: new Date()});
											 						}else{
											 							console.log('Added to group status queue');
											 							addToPendingGroupStatusReport({group_id: msg.group_id, type: "atg", to: doc.members[i].user_id, delivered: new Date()});
											 						}		
											 					});
											 		
											 				}
											 			}
											 		}); //cursor ends
											 	}); //find ends
											 	
											 	
											 });

}

//parameter msg contains array of members to remove from the group
function removeGroupMembers(socket, msg){
	var Members = [];
	for(var i=0;i<msg.members.length; i++){
		Members.push(msg.members[i].user_id);
	}

		DB.collection('groupmessage').update({_id: new ObjectId(msg.group_id)},
											 {$pull: 
											 	{
											 		members: { user_id: {$in: Members} }
											 	},
											  $inc: {count:-Members.length}
											 },
											 {$multi: true},
											 function(err, result){
											 	console.log(err);
											 	//socket.emit('group-members-removed', {_id: msg.group_id}); //Send ack to member who added users to the group
											 	DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{members:1, name: 1},
											 	 function(err, cursor){
											 		cursor.nextObject(function(err, doc){
											 			if(doc!=null){
											 				for(var i=0; i<doc.members.length; i++){  //send ack to members who are added to the group
											 					getSocketId(doc.members[i].user_id, function(socket_id){
											 						if(socket_id != null){
											 							socket.broadcast.to(socket_id).emit('group-members-removed', {_id: msg.group_id, user_id: msg.user_id, members: Members, datetime: new Date()});
											 						}else{
											 							console.log('Added to group status queue');
											 							addToPendingGroupStatusReport({group_id: msg.group_id, type: "rfg", to: doc.members[i].user_id, delivered: new Date(), from: msg.user_id});
											 						}		
											 					});
											 		
											 				}
											 			}
											 		}); //cursor ends
											 	}); //find ends
											 	
											 	
											 });

}

function addToPendingDeliveryReport(doc){
		DB.collection('deliveryreport').insertOne({message_id: doc._id, to: doc.from, delivered: doc.datetime}, function(err, result){
			console.log('added to pending queue');
		});

}

function addToPendingDeliveryReportGroup(doc, timeStamp){
		DB.collection('deliveryreport').insertOne({message_id: doc._id, to: doc.from, delivered: timeStamp}, function(err, result){
			console.log('added to pending queue');
		});

}

function addToPendingGroupStatusReport(doc){
	DB.collection('groupstatus').insertOne(doc, function(err, result){
		console.log('added to pending group status');
	});
}








