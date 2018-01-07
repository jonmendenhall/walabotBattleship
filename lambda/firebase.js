const https = require("https")

class Firebase {
	
	constructor() {
		this.host = ""
	}

	// get value from firebase

	get(key) {
		return new Promise((resolve, reject) => {
			var options = {
				hostname: this.host,
				port: 443,
				path: key + ".json",
				method: 'GET'
			}
			var req = https.request(options, function (res) {
				res.setEncoding('utf8')
				var body = ''
				res.on('data', function(chunk) {
					body += chunk
				})
				res.on('end', function() {
					resolve(JSON.parse(body))
				})
			})
			req.end()
			req.on('error', reject)
		})
	}

	// put value to firebase

	put(key, value) {
		return new Promise((resolve, reject) => {
			var options = {
				hostname: this.host,
				port: 443,
				path: key + ".json",
				method: 'PUT'
			}
			var req = https.request(options, function (res) {
				res.setEncoding('utf8')
				var body = ''
				res.on('data', function(chunk) {
					body += chunk
				})
				res.on('end', function() {
					resolve()
				})
			})
			req.end(JSON.stringify(value))
			req.on('error', reject)
		})
	}

	// listen for changes on firebase

	listen(key, callback) {
		var options = {
			hostname: this.host,
			port: 443,
			path: key + ".json",
			method: 'PUT',
			headers: {
				"Accept": "text/event-stream"
			}
		}
		var req = https.request(options, function (res) {
			var i = 0
			res.setEncoding('utf8')
			res.on('data', function(chunk) {
				var args = chunk.split("\n")
				var method = args[0].substring(7)
				if(method == "keep-alive")
					return
				var event = JSON.parse(args[1].substring(6))
				event.index = i++
				event.method = method
				if(callback(event))
					res.destroy()
			})
		})
		req.end()
	}

}

module.exports = new Firebase()