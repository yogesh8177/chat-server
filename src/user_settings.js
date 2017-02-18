var server = require('./server2');
var ObjectId = require('mongodb').ObjectId;

var self = module.exports = {

	updateUserStatus: function (socket, msg){
		console.log(msg.status);
		server.DB.collection('users').update({_id: new ObjectId(msg.user_id)},
									{$set:{status: msg.status}},
									function(err, result){
										if(!err){
											socket.emit('status-changed', {user_id: msg.user_id, status: msg.status}); //send to user itself
											self.broadcastToAllStatusChanged(socket, msg);
										}
									});
	},


	broadcastToAllStatusChanged: function broadcast(socket, msg){
		var user_ids = [];

		server.DB.collection('users').find({}, {name:1}, function(err, cursor){
			cursor.forEach(function(doc){
				user_ids.push(doc._id.toString());
			}, function(){

				for(var i=0; i<user_ids.length; i++){
					server.getSocketId(user_ids[i], function(socket_id){
						if(socket_id != null){
							console.log('Status update sent');
							socket.broadcast.to(socket_id).emit('status-changed', {user_id: msg.user_id, status: msg.status});
						}else{
							self.addToPending({category: 'status-changed', to: user_ids[i], user_id: msg.user_id, status: msg.status});
						}
					});
				}
				
			});
		});
	},

	addToPending: function(doc){
		server.DB.collection('pendingqueue').insertOne(doc, function(err, result){
			console.log('status change added to pending queue');
		});
	}

}