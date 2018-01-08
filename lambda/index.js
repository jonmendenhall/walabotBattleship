// -------------------------
// Import required libraries
// -------------------------

const Alexa = require("alexa-sdk")
const firebase = require("./firebase.js")
const blueprintData = require("./firebaseBlankData.json")



// ---------------------------------------
// Create variables for use in Alexa Skill
// ---------------------------------------

firebase.host = "walabotbattleship.firebaseio.com"			// PROJECT.firebaseio.com
const s3bucket = "walabotbattleship"						// the name of your S3 bucket where sounds are stored

const alexaAccuracy = 0.35									// how accurate alexa is in single player against you 0% - 100%
const sectors = ["north", "east", "south", "west"]			// possible sectors to use in game

// SOUNDS FROM ZAPSPLAT AND SOUNDBIBLE
const audioRadar = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/radar.mp3"/>'			// a radar noise
const audioSiren = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/siren.mp3"/>'			// a siren noise
const audioWhistle = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/whistle.mp3"/>'		// a whistle noise
const audioExplosion = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/explosion.mp3"/>'	// an explosion noise
const audioCannon = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/cannon.mp3"/>'			// a cannon noise
const audioSplash = '<audio src="https://s3.amazonaws.com/' + s3bucket + '/splash.mp3"/>'			// a splash noise

// makes speech have delays to sound better
const break1 = '<break time="0.5s"/>'	// 0.5s delay
const break2 = '<break time="1s"/>'		// 1s delay

// states for this skill
const states = {
	playerSelect: "playerSelect",
	attack: "attack",
	playAgain: "playAgain"
}




// ------------------------------------------
// Intent handlers for when skill is launched
// ------------------------------------------

const modeHandlers = {
	"Unhandled": function() {
		// ask user what mode to play
		const prompt = "Would you like to play single player or multiplayer?"
		this.emit(":ask", prompt, prompt)
	},
	"ModeIntent": function() {
		// user decided mode
		const mode = this.event.request.intent.slots.mode.value
		this.attributes.mode = mode

		// get data from database
		firebase.get("/").then((data) => {
			var promises = []
			if(data == null)
				promises = [firebase.put("/", data = blueprintData)]
			
			Promise.all(promises).then(() => {
				// this person could be player1 or player2	
				var player1 = data[1].mode == 0
				var player2 = data[2].mode == 0

				// if either, ask who it is
				if(player1 && player2) {
					const prompt = "Are you player 1, or 2?"
					this.handler.state = states.playerSelect
					this.emit(":ask", prompt, prompt)
				} else if(player1 || player2) {
					// we know which one it has to be (2 options, and 1 is already taken...)
					this.attributes.player = player1 ? 1 : 2

					// check if that player is not playing
					if(data[this.attributes.player].mode == 0) {
						// start a game
						startGame(this, data, mode)
					} else {
						// that player is playing, tell the person
						this.emit(":tell", "Hmmm, it looks like player" + this.attributes.player + " is already playing. Try again later.")
					}
				} else {
					// neither player is available to play as
					this.emit(":tell", "Hmmm, it looks like both players are already playing. Try again later.")
				}
			})
		})

	},
	"SessionEndedRequest": function() {
		// person wanted to quit
		this.emit()
	}
}




// -----------------------------------------
// Intent handlers for asking who to play as
// -----------------------------------------

const playerSelectHandlers = Alexa.CreateStateHandler(states.playerSelect, {
	"PlayerIntent": function() {
		// which player did the person choose
		this.attributes.player = parseInt(this.event.request.intent.slots.player.value)

		// get data from database
		firebase.get("/").then((data) => {
			// check if that player is not playing
			if(data[this.attributes.player].mode == 0) {
				// start a game
				startGame(this, data, this.attributes.mode)
			} else {
				// that player is playing, tell the person
				this.emit(":tell", "Hmmm, it looks like player" + this.attributes.player + " is already playing. Try again later.")
			}
		})

	},
	"Unhandled": function() {
		// could not understand person's answer
		const speech = "Sorry, I could not understand what you said. "
		const prompt = "Are you player 1, or 2?"
		this.emit(":ask", speech + prompt, prompt)
	},
	"SessionEndedRequest": function() {
		// person wanted to quit
		this.emit()
	}
})




// -----------------------------------------------------------------
// Intent handlers for main game play (singleplayer and multiplayer)
// -----------------------------------------------------------------

const attackHandlers = Alexa.CreateStateHandler(states.attack, {
	"AttackIntent": function() {
		// get a constant reference to 'this'
		var self = this

		// get data from database
		firebase.get("/").then((data) => {
			// check if playing playing multiplayer
			if(self.attributes.mode == 2) {
				// check if this is their first turn
				if(self.attributes.turn == 0) {
					self.attributes.turn++
					// check if the player started the multiplayer game
					if(self.attributes.firstPlayer) {
						// send a directive and wait for other player to join
						Promise.all([directiveSpeak(self, "Go to a sector to defend." + audioRadar), waitForTurn()]).then(() => {
							// once the 2nd player joins, ask where to attack
							const prompt = "Say a compass sector to attack."
							self.emit(":ask", prompt, prompt)
						})
					} else {

						// Promise.all( [first, second] ).then((values) => {
						// 		first response = values[0]
						//		second response = values[1]
						// })

						// the player is the 2nd player, wait for 1st player to attack
						Promise.all([directiveSpeak(self, "Go to a sector to defend." + audioRadar), waitForTurn()]).then(([, hit]) => {
							// handle 1st player's attack
							handleAttack(self, data[self.attributes.player], hit)
						})




					}
				} else {
					// it is the next turn, player wants to attack a sector
					const playerTarget = self.event.request.intent.slots.sector.value

					// get reference to the enemy, and this player in database
					var enemy = data[self.attributes.enemy]
					var player = data[self.attributes.player]

					// create initial speech
					var speech = playerTarget + " sector coordinates locked to attack. Defending the " + player.sector + " sector. Firing artillary." + audioCannon + break1
					
					// check if player hit the enemy
					var hit = playerTarget == enemy.sector
					var enemySunk = false

					if(hit) {
						// if hit, add "Hit" to speech
						speech += "Target hit!"
						// decrement the stored enemy health value
						if(--self.attributes.enemyHealth == 0)
							enemySunk = true
					} else {
						// didn't hit the enemy
						speech += "Target missed!"
					}

					// check if the enemy sunk
					if(enemySunk) {
						// add congratulation to speech, and ask player to play again
						speech += " Congratulations, you defeated the enemy!"
						const prompt = "Would you like to play again?"

						// set player's mode to 0, notify the database that the enemy was hit, set turn to 0 for the next multiplayer game
						Promise.all([firebase.put("/" + self.attributes.player + "/mode", 0), nextTurn(data, true, 0)]).then(() => {
							// tell speech and ask player the prompt
							self.handler.state = states.playAgain
							self.emit(":ask", speech + prompt, prompt)
						})
					} else {
						// not sunk, tell player to move to a new sector
						speech += " Go to a sector to defend." + audioRadar
						Promise.all([directiveSpeak(self, speech), nextTurn(data, hit)]).then(() => {
							// wait for the enemy's turn after telling player to move, and notifying enemy it is their turn and if we hit them
							return waitForTurn()
						}).then((hit) => {
							// the enemy fired at us, handle the attack, based on if they hit us
							handleAttack(self, data[self.attributes.player], hit)
						})
					}
				}

			} else {
				// get reference to this player
				var game = data[this.attributes.player]

				// get player's target, and randomly generate the enemy's target based on chance of hitting player (alexaAccuracy)
				const playerTarget = this.event.request.intent.slots.sector.value
				const alexaTarget = Math.random() <= alexaAccuracy ? game.sector : sectors.filter(function(x){return x != game.sector})[Math.floor(Math.random() * 3)]

				var enemySunk = false
				var playerSunk = false

				// create the initial speech
				var speech = playerTarget + " sector coordinates locked to attack. Defending the " + game.sector + " sector. Firing artillary." + audioCannon + break1
				var prompt	

				// check if the player hit the enemy (Alexa)
				if(playerTarget == game.alexaSector) {
					// hit
					speech += "Target hit!"
					// decrease Alexa's health
					if(--game.alexaHealth == 0)
						enemySunk = true
					else
						// Alexa will move to a random sector if the player hit her
						game.alexaSector = sectors[Math.floor(Math.random() * 4)]
				} else {
					// miss
					speech += "Target missed!"
				}

				// add the enemy's attack to speech
				speech += break1 + "Incoming fire!" + break1 + audioWhistle
				
				// check if Alexa hit the player
				if(alexaTarget == game.sector) {
					// hit
					speech += audioExplosion + break1
					// decrease player's health
					if(--game.health == 0) {
						// tell player they were sunk
						speech += " The enemy has sunk your ship. "
						playerSunk = true
					} else {
						// tell player they can't get hit again
						speech += " The hull can not take another hit like that. "
					}
				} else {
					// Alexa missed
					speech += audioSplash + "The enemy missed your ship! "
				}

				// default to player lost
				game.mode = 0
				prompt = "Would you like to play again?"
				this.handler.state = states.playAgain

				if(enemySunk && playerSunk) {
					// the enemy sunk AND the player sunk (TIE)
					speech += "After a long battle at sea, you sunk eachothers ships. "
				} else if(enemySunk) {
					// the enemy sunk (WIN)
					speech += "Congratulations, you defeated the enemy! "
				} else if(!playerSunk) {
					// neither player sunk, game is not over
					game.mode = 1
					// ask player where to attack
					speech += "Go to a sector to defend." + audioRadar + " "
					prompt = "Say a compass sector to attack."
					this.handler.state = states.attack
				}

				// update the data in the database for this player
				firebase.put("/" + this.attributes.player, game).then(() => {
					// send the whole speech variable to the Alexa Device
					this.emit(":ask", speech + prompt, prompt)
				})
			}
		})
		
	},
	"Unhandled": function() {
		// dont understand what sector to attack
		const speech = "I could not understand what you said. "
		const prompt = "Say a compass sector to attack."
		this.emit(":ask", speech + prompt, prompt)
	},
	"SessionEndedRequest": function() {
		// person wants to quit
		exitGame(this)
	}
})




// ------------------------------------------------------
// Intent handlers for asking if user wants to play again
// ------------------------------------------------------

const playAgainHandlers = Alexa.CreateStateHandler(states.playAgain, {
	"AMAZON.YesIntent": function() {
		// call the first method when starting the skill ("Do you want to play...")
		this.handler.state = ""
		delete this.attributes.STATE
		this.emitWithState("NewSession")
	},
	"AMAZON.NoIntent": function() {
		// player does not want to play again
		console.log("NoIntent")
		exitGame(this, ":tell", "Ok, goodbye.")
	},
	"Unhandled": function() {
		// player said an unknown response
		const speech = "I could not understand what you said. "
		const prompt = "Would you like to play again?"
		this.emit(":ask", speech + prompt, prompt)
	},
	"SessionEndedRequest": function() {
		// player wants to quit the game
		exitGame(this)
	}
})




// ----------------------------------
// Functions repeatedly used in skill
// ----------------------------------

// sets up all game variables and begins the game

function startGame(self, data, mode) {
	// check what mode to start
	if(mode == "single player") {
		// set variables for a singleplayer game
		self.attributes.mode = 1
		var game = data[self.attributes.player]

		// set Alexa health and sector (enemy in single player)
		game.alexaHealth = 2
		game.alexaSector = sectors[Math.floor(Math.random() * 4)]

		// set players health and mode to 1 (SINGLEPLAYER)
		game.health = 2
		game.mode = 1

		// tell user information and ask user where to attack
		const speech = "Ok, starting a single player game of battleship. Go to a sector to defend." + audioRadar + break1
		const prompt = "Say a compass sector to attack."

		// skill is now in attack mode (playing)
		self.handler.state = states.attack

		// update new data in database for this player
		firebase.put("/" + self.attributes.player, game).then(() => {
			// output the speech after done updating
			self.emit(":ask", speech + prompt, prompt)
		})
	} else {
		// set variables for multiplayer game
		// anything in self.attributes will persist throughout the whole game
		self.attributes.mode = 2

		// set which player is the enemy (for use in database), and initialize enemy health
		self.attributes.enemy = self.attributes.player == 1 ? 2 : 1
		self.attributes.enemyHealth = 2

		// this is the first turn of the multiplayer game
		self.attributes.turn = 0

		// you are the first player in multiplayer if "/multiplayer/turn" == 0
		self.attributes.firstPlayer = data.multiplayer.turn == 0
		if(self.attributes.firstPlayer)
			data.multiplayer.hit = false

		// notifys the first player that you joined
		data.multiplayer.turn++

		// get reference to player, and set information for this player
		var player = data[self.attributes.player]
		player.health = 2
		player.mode = 2

		// skill is now in attack mode (playing)
		self.handler.state = states.attack

		// (update data for player in database), (update multiplayer data in database)
		Promise.all([firebase.put("/" + self.attributes.player, player), firebase.put("/multiplayer", data.multiplayer)]).then(() => {
			// after all that, call the attack method
			self.emitWithState("AttackIntent")
		})
	}
}	

// send a directive with speech to the Amazon Alexa Device

function directiveSpeak(self, speech) {
	// send a directive with speech
	const ds = new Alexa.services.DirectiveService()
	const directive = new Alexa.directives.VoicePlayerSpeakDirective(self.event.request.requestId, speech)
	return ds.enqueue(directive, self.event.context.System.apiEndpoint, self.event.context.System.apiAccessToken)
}

// function used for multiplayer when waiting for enemy to fire at a sector

function waitForTurn() {
	// return a Promise which is resolved when "/multiplayer/turn" increases
	return new Promise((resolve, reject) => {
		// listen for changes to "/multiplayer"
		firebase.listen("/multiplayer", (event) => {
			// resolves when "/multiplayer/" is changed
			if(event.index > 0 && event.path != "/hit") {
				resolve(event.data.hit)
			}
		})
	})
}

// function used in multiplayer to tell the database it is the other player's turn

function nextTurn(data, hit, turn) {
	// sets the turn number, and if the player hit the enemy for this turn
	data.multiplayer.hit = hit
	if(turn != null)
		data.multiplayer.turn = turn
	else
		data.multiplayer.turn++

	// return the Promise of updating the database
	return firebase.put("/multiplayer", data.multiplayer)
}

// creates the speech for when there is incoming fire

function handleAttack(self, player, hit) {
	// all attack speeches start with "Incoming fire! *BOMB DROP WHISTLE*"
	var speech = "Incoming fire!" + break1 + audioWhistle
	var sunk = false

	// speech += wasHit ? "true " : "false "

	// console.log("Hit: " + hit)
	// check if the player was hit
	if(hit) {
		// add an explosion to the output speech
		speech += audioExplosion + break1

		// decrease player health and check if they have no more health
		if(--player.health == 0) {
			// add a sunk message to the speech
			sunk = true
			speech += "The enemy sunk your ship. "
			player.mode = 0
		} else {
			// the player didn't sink, but they will next hit
			speech += "The hull can not take another hit like that. "
		}
	} else {
		// the player wasn't hit, the bomb landed in the water, add a splash noise
		speech += audioSplash
	}

	// update database with new player health for this turn
	firebase.put("/" + self.attributes.player, player).then(() => {
		if(sunk) {
			// the player sunk
			const prompt = "Would you like to play again?"
			self.handler.state = states.playAgain
			self.emit(":ask", speech + prompt, prompt)
		} else {
			// the player has not sunk, ask where to attack
			const prompt = "Say a compass sector to attack."
			self.emit(":ask", speech + prompt, prompt)
		}
	})
}

// used when the player wants to exit, and tells database player is no longer playing

function exitGame() {
	// get arguments provided to this function, and a reference to Alexa object
	var args = Array.from(arguments)
	var self = args.shift()

	// set "/PLAYER/mode" to 0 in database (means NOT_PLAYING)
	firebase.put("/" + self.attributes.player + "/mode", 0).then(() => { 
		// call emit with arguments provided to this function
		self.emit.apply(self, args)
	})
}




// --------------------
// Entry point of skill
// --------------------

exports.handler = function(event, context, callback) {	
	// register all intent handlers
	const alexa = Alexa.handler(event, context)
	alexa.registerHandlers(modeHandlers, playerSelectHandlers, attackHandlers, playAgainHandlers)

	// execute the Alexa Skill
	alexa.execute()
}





