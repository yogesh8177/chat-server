
var server = require('./server2');
var ObjectId = require('mongodb').ObjectId;

var self = module.exports = {

typing: function typing(socket, msg){
	server.DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)}, {members:1}, function(err, cursor){
		cursor.nextObject(function(err, doc){
			if(doc != null){
				for(var i=0; i< doc.members.length; i++){
					server.getSocketId(doc.members[i].user_id, function(socket_id){
						if(socket_id != null){
							socket.broadcast.to(socket_id).emit('group-typing', {user_id: msg.user_id});
						}
					});
				}
			}
		});
	});
},

create : function createGroup(socket, msg){
	var group = new Object();
	group.creator = msg.creator;
	group.name = msg.name;
	group.created_at = new Date();
	group.members = msg.members;
	group.count = msg.members.length;

	for(var i=0; i< group.count; i++){
		group.members[i].join_date = new Date();
	}

		server.DB.collection('groupmessage').insertOne(group, function(err, result){
			socket.emit('group-created', {_id: result.ops[0]._id, datetime: result.ops[0].created_at});
		});
},

delete: function deleteGroup(socket, msg){
	DB.collection('groupmessage').remove({_id: new ObjectId(msg.group_id)}, function(err, result){
		socket.emit('group-deleted',{_id: msg.group_id});
	});
},

addMessage: function addGroupMessage(msg, callback){
	var message = new Object();
	message.from = msg.from;
	message.group_id = msg.group_id;
	message.type = msg.type;
	message.body = msg.body;
	message.datetime = new Date();
	message.delivered_to = [];
	message.read_by = [];

//check how many members in a group from group document
		server.DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{count:1}, function(err, cursor){
			cursor.nextObject(function(err,doc){
			if(doc!=null){
				message.delivery_counter = doc.count <= 0 ? 0 : doc.count - 1;
				console.log('Members')
				server.DB.collection('groupmessage').insertOne(message, function(err, result){		//insert message after updating delivery_counter (Total members in a group)
					callback(result.ops[0]._id);
					console.log('Added to group message');
				});
			}				
			});
		}); 

},
sendMessage: function sendGroupMessage(socket, msg){
			var timeStamp = new Date();	
			server.DB.collection('groupmessage').find({_id:new ObjectId(msg._id)}, function(err, cursor){ //find group object through message obj
				cursor.nextObject(function(err, message){
					server.DB.collection('groupmessage').find({_id:new ObjectId(message.group_id)}, function(err, cursor){
						cursor.nextObject(function(err, group){
							if(group!=null){
								for(var j=0; j<group.members.length; j++){
									server.getSocketId(group.members[j].user_id, function(socket_id){
										if(socket_id!=null){
											console.log('group sent');
											socket.broadcast.to(socket_id).emit('group-message', {group_id: group._id,_id: message._id,from: message.from, type: message.type, body: message.body, datetime: timeStamp});
										}else{
											console.log('Added to group pending queue');
											self.addToPendingDelivery({category: 'group-message',group_id: group._id,_id: message._id,from: message.from, to: group.members[j].user_id, type: message.type, body: message.body, datetime: timeStamp});
										}
									});	
								}	
							}
									
						});
					});
				});
			});
},

deliveryAck: function groupDeliveryAck(socket, msg){
		var timeStamp = new Date();
		server.DB.collection('groupmessage').update({_id: new ObjectId(msg._id)},
		 									{ $push:
		 										{	//update delivery counter
		 											delivered_to: {user_id: msg.user_id, datetime: timeStamp}		 											
		 										},
		 									  $inc: {delivery_counter:-1}
		 									},function(err, cursor){
												//send ack to end users here...
												server.DB.collection('groupmessage').find({_id: new ObjectId(msg._id)},{from:1, delivered_to:1}, function(err, cursor){
													
													cursor.nextObject(function(err,doc){
														if(doc!= null){
															server.getSocketId(doc.from, function(socket_id){
																if(socket_id!=null){
																	socket.broadcast.to(socket_id).emit('group-delivery-receipt', {_id: msg._id, delivered_to: msg.user_id, datetime: timeStamp});
																}else{
																	self.addToPendingDelivery( {category:'group-delivery-receipt', _id: msg._id, to: doc.from, delivered_to: msg.user_id, datetime: timeStamp});
																}
															});
															
														}
													});
												});
											});
},

broadcast : function broadcastGroupCreated(socket, msg){
	console.log('broadcast group created');
	server.DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)}, {members:1, name:1},
		function(err, cursor){
			cursor.nextObject(function(err, doc){
				if(doc!=null){
					for(var i=0; i<doc.members.length; i++){
						server.getSocketId(doc.members[i].user_id, function(socket_id){
							if(socket_id!=null){
								socket.broadcast.to(socket_id).emit('added-to-new-group',{group_id: doc._id, name: doc.name, members: doc.members, datetime: doc.members[i].join_date});
							}else{
								self.addToPendingStatus({category:'added-to-new-group', group_id: doc._id, to: doc.members[i].user_id, name: doc.name, members: doc.members, datetime: doc.members[i].join_date});
							}					
						});
					}
				}
			});
		});
},

//parameter msg contains array of members to add to the group
addMembers : function addGroupMembers(socket, msg){
	var Members = [];
	for(var i=0; i<msg.members.length; i++){
		var member = new Object();
		member.user_id = msg.members[i].user_id;
		member.join_date = new Date();
		Members.push(member);
	}
	var timeStamp = new Date();
		server.DB.collection('groupmessage').update({_id: new ObjectId(msg.group_id)},
											 {$push: 
											 	{
											 		members: {$each: Members}
											 	},
											  $inc: {count:Members.length}											 
											 },
											 { upsert: true },
											 function(err, result){
											 	if(err)console.log(err);
											 	socket.emit('group-members-added', {_id: msg.group_id}); //Send ack to member who added users to the group
											 	server.DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{members:1, name: 1},
											 	 function(err, cursor){
											 		cursor.nextObject(function(err, doc){
											 			if(doc!=null){
											 				for(var i=0; i<doc.members.length; i++){  //send ack to members who are added to the group
											 					server.getSocketId(doc.members[i].user_id, function(socket_id){
											 						if(socket_id != null){
											 							socket.broadcast.to(socket_id).emit('added-to-group', {_id: msg.group_id, name: doc.name, members: Members, datetime: timeStamp});
											 						}else{
											 							console.log('Added to group status queue');
											 							self.addToPendingStatus({category:'added-to-group', _id: msg.group_id, to: doc.members[i].user_id, name: doc.name, members: Members, delivered: timeStamp});
											 						}		
											 					});
											 		
											 				}
											 			}
											 		}); //cursor ends
											 	}); //find ends
											 	
											 	
											 });

},

//parameter msg contains array of members to remove from the group
removeMembers : function removeGroupMembers(socket, msg){
	var Members = [];
	for(var i=0;i<msg.members.length; i++){
		Members.push(msg.members[i].user_id);
	}
	var timeStamp = new Date();
		server.DB.collection('groupmessage').update({_id: new ObjectId(msg.group_id)},
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
											 	server.DB.collection('groupmessage').find({_id: new ObjectId(msg.group_id)},{members:1, name: 1},
											 	 function(err, cursor){
											 		cursor.nextObject(function(err, doc){
											 			if(doc!=null){
											 				for(var i=0; i<doc.members.length; i++){  //send ack to members who are added to the group
											 					server.getSocketId(doc.members[i].user_id, function(socket_id){
											 						if(socket_id != null){
											 							socket.broadcast.to(socket_id).emit('group-members-removed', {_id: msg.group_id, user_id: msg.user_id, members: Members, datetime: timeStamp});
											 						}else{
											 							console.log('Added to group status queue');
											 							self.addToPendingStatus({category:'group-members-removed', _id: msg.group_id, to: doc.members[i].user_id, user_id: msg.user_id, members: Members, datetime: timeStamp});
											 						}		
											 					});
											 		
											 				}
											 			}
											 		}); //cursor ends
											 	}); //find ends
											 	
											 	
											 });

},

addToPendingDelivery : function addToPendingDeliveryReportGroup(doc){
		server.DB.collection('pendingqueue').insertOne(doc, function(err, result){
			console.log('added to pending queue');
		});

},

addToPendingStatus : function addToPendingGroupStatusReport(doc){
	server.DB.collection('pendingqueue').insertOne(doc, function(err, result){
		console.log('added to pending group status, '+doc.to);
	});
}

}//export ends
