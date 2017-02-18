var server = require('./server2');
var ObjectId = require('mongodb').ObjectId;

var self = module.exports = {

typing: function typing(socket, msg){
	server.getSocketId(msg.user_id, function(socket_id){
		if(socket_id!=null)
			socket.broadcast.to(socket_id).emit('private-typing',{user_id: msg.user_id});
	});
},
sendMessage : function sendPrivateMessage(socket, msg){
	console.log('sendPrivateMessage called');
			server.DB.collection('privatemessage').find({_id: new ObjectId(msg._id)}, function(err, cursor){
				cursor.nextObject(function(err, message){
					if(message!=null){
						server.getSocketId(message.to, function(socket_id){
							if(socket_id != null){
								console.log('Sent');
								socket.broadcast.to(socket_id).emit('private-message',{_id: message._id, from: message.from, to:message.to, type: message.type, body: message.body, datetime: new Date()});
							}else{
								console.log('Not online');
								self.addToPending({category: 'private-message',_id: message._id,from: message.from, to: message.to, type: message.type, body: message.body, datetime: new Date()})
							}
						});					
					}
				});
			});
},

deliveryAck : function privateDeliveryAck(socket, msg){
		server.DB.collection('privatemessage').find({_id: new ObjectId(msg._id)},function(err, cursor){
			cursor.nextObject(function(err, doc){
				if(doc!=null){
					doc.delivered = new Date();
					server.getSocketId(doc.from, function(socket_id){console.log(doc.from);
						if(socket_id != null){
							socket.broadcast.to(socket_id).emit('private-delivery-receipt', {_id: doc._id, datetime: doc.delivered});						
						}else{
							console.log('Recipient not online');
							self.addToPending({category:'private-delivery-receipt', _id: doc._id, to: doc.from, datetime: doc.delivered});
						}
					});				
				}
			});
		});
},

//save message to db 
addMessage: function addPrivateMessage(msg, callback){
	var message = new Object();
	message.from = msg.from;
	message.to = msg.to;
	message.type = msg.type;
	message.body = msg.body;
	message.datetime = new Date();
	message.delivered = '';
	message.read = '';

		server.DB.collection('privatemessage').insertOne(message, function(err,result){
			//db.close();
			if(err){
				console.log(err);
			}else{console.log('added-private');
				callback(result.ops[0]._id);
			}
			
		});
},

addToPending: function addToPendingDeliveryReport(doc){
		server.DB.collection('pendingqueue').insertOne(doc, function(err, result){
			console.log('added to pending queue');
		});

}

}//export ends