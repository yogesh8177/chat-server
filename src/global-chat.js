var server = require('./server2');
var ObjectId = require('mongodb').ObjectId;

var GLOBAL_MESSAGES = [];
var GLOBAL_HISTORY_SIZE = 20;

module.exports = {

sendMessage: function sendGlobalMessage(socket, message){
	for(var i=0; i<GLOBAL_MESSAGES.length; i++){
		if(GLOBAL_MESSAGES[i]._id === message._id){
			socket.broadcast.emit('global-message', {_id: message._id, from: message.from, type: message.type, body: message.body, datetime: message.datetime});
			break;
		}
	}
},

addMessage: function addGlobalMessage(msg, callback){
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

}//export ends