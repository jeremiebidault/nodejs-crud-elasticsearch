const http = require('http');
const fs = require('fs');

const WebSocket = require("ws");
const websocket = new WebSocket.Server({ port: 12346 });

const { Client } = require('@elastic/elasticsearch');
const client = new Client({ node: 'http://10.0.0.103:9200' });




///// http

http.createServer((request, response) => {

    console.log(request.url);

    if (request.method === 'GET' && request.url === '/') {
        fs.readFile('index.html', (err, data) => {
            if (err) {
                console.log(err);
            }
            else {
                response.on('error', (err) => { console.error(err); });
                response.writeHead(200, {'Content-Type': 'text/html'});
                response.end(data);
            }
        });
        return;
    }

    if (request.method === 'POST' && request.url === '/post') {

        let body = [];
        request.on('error', (err) => { console.error(err); })
        .on('data', (chunk) => { body.push(chunk); })
        .on('end', () => {
            body = Buffer.concat(body).toString();

            let query;
            try {
                query = JSON.parse(body);
            } catch (err) {
				response.on('error', (err) => { console.error(err); });
                response.writeHead(404, {'Content-Type': 'text/plain'});
                response.end('invalid request');
                return console.error(err);
			}

			console.log(query);

			if (query.event && query.event === "create") {
				client.cat.indices({
					"index" : "crud*",
					"format": "json",
					"h" : "index,creation.date.string",
					"s" : "creation.date.string",
				}, (err, { body }) => {
					if (!err) {
						query.data.index = body[body.length - 1].index;
						client.index({
							"index" : query.data.index,
							"refresh" : "wait_for",
							"body" : {
								"created" : new Date(),
								"updated" : new Date(),
								"input" : query.data.input,
								"textarea" : query.data.textarea,
								"select" : query.data.select,
								"checkbox" : query.data.checkbox,
							},
						}, (err, res) => {
							if (!err) {
								response.on('error', (err) => { console.error(err); });
								response.writeHead(200, {'Content-Type': 'application/json'});
								response.end(JSON.stringify({
									event : "create",
									data : res
								}));
								client.search({
									"index" : query.data.index,
									"body" : {
										"query" : {
											"match" : {
												"_id" : res.body._id
											}
										}
									}
								}, (err, res) => {
									if (!err) {
										websocket.broadcast(JSON.stringify({
											event : "create",
											data : res
										}));
									}
									else {
										console.error(err);
									}
								});
							}
							else {
								console.error(err);
							}
						});
					}
					else {
						console.error(err);
					}
				});
			}

			if (query.event && query.event === "update") {
				client.update({
					"id" : query.data.id,
					"index" : query.data.index,
					"refresh" : "wait_for",
					"retry_on_conflict" : 10,
					"body" : {
						"doc" : {
							"updated" : new Date(),
							"input" : query.data.input,
							"textarea" : query.data.textarea,
							"select" : query.data.select,
							"checkbox" : query.data.checkbox,
						}
					},
				}, (err, res) => {
					if (!err) {

						response.on('error', (err) => { console.error(err); });
						response.writeHead(200, {'Content-Type': 'application/json'});
						response.end(JSON.stringify({
							event : "update",
							data : res
						}));

						client.search({
							"index" : query.data.index,
							"body" : {
								"query" : {
									"match" : {
										"_id" : res.body._id
									}
								}
							}
						}, (err, res) => {
							if (!err) {
								websocket.broadcast(JSON.stringify({
									event : "update",
									data : res
								}));
							}
							else {
								console.error(err);
							}
						});
					}
					else {
						console.error(err);
					}
				});
			}

			if (query.event && query.event === "delete") {
				client.delete({
					"id" : query.data.id,
					"index" : query.data.index,
					"refresh" : "wait_for",
				}, (err, res) => {
					if (!err) {
						response.on('error', (err) => { console.error(err); });
						response.writeHead(200, {'Content-Type': 'application/json'});
						response.end(JSON.stringify({
							event : "delete",
							data : res
						}));
						websocket.broadcast(JSON.stringify({
							event : "delete",
							data : res
						}));
					}
					else {
						console.error(err);
					}
				});
			}

        });

        return;
    }

	response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end('invalid request');

}).listen(12345, "0.0.0.0", () => {
    console.log("server listening http://0.0.0.0:12345");
});




///// websocket

console.log("server listening ws://0.0.0.0:12346");

websocket.broadcast = function(message) {
	websocket.clients.forEach((client) => {
		client.send(message);
	});
};

websocket.on("connection", (ws, req) => {
	
	client.search({
		"index" : "crud",
		"body" : {
			"query" : {
				"match_all" : {}
			}
		}
	}, (err, res) => {
		if (!err) {
			ws.send(JSON.stringify({
				event : "hydrate",
				data : res
			}));
		}
	});

	ws.on("message", (e) => {
		console.log(e);
	});
	ws.on("close", (e) => {
		console.log(e);
	});
});

var update = new Date();
setInterval(() => {
	client.search({
		"index" : "crud",
		"body" : {
			"sort" : [
				{
					"updated" : {
						"order" : "desc"
					}
				}
			],
			"query" : {
				"range" : {
					"updated" : {
						"gte" : update,
					}
				}
			}
		}
	}, (err, res) => {
		if (!err) {
			update = new Date();
			websocket.broadcast(JSON.stringify({
				event : "update",
				data : res
			}));
		}
		else {
			console.error(err);
		}
	});
}, 5000);