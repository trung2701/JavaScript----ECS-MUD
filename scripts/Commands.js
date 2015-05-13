/**
 * scripts/Commands.js
 * 
 * This file provides the main game logic; unfortunately it's 
 * not complete so you'll need to finish it!
 *
 * @author Jonathon Hare (jsh2@ecs.soton.ac.uk)
 * @author ...
 */
var db = require('../models');
var controller = require('./Controller');
var predicates = require('./Predicates');
var strings = require('./Strings');
var CommandHandler = require('./CommandHandler');
var PropertyHandler = require('./PropertyHandler');

/**
 * The commands object is like a map of control strings (the commands detailed 
 * in the ECS-MUD guide) to command handlers (objects extending from the 
 * CommandHandler object) which perform the actions of the required command.
 * 
 * The controller (see Controller.js) parses the statements entered by the user,
 * and passes the information to the matching property in the commands object.
 */
var commands = {
	//handle user creation
	create: CommandHandler.extend({
		nargs: 2,
		preLogin: true,
		postLogin: false,
		validate: function(conn, argsArr, cb) {
			if (!predicates.isUsernameValid(argsArr[0])) {
				controller.sendMessage(conn, strings.badUsername);
				return;
			}

			if (!predicates.isPasswordValid(argsArr[1])) {
				controller.sendMessage(conn, strings.badPassword);
				return;
			}

			controller.loadMUDObject(conn, {name: argsArr[0], type: 'PLAYER'}, function(player) {
				if (!player) {
					cb(conn, argsArr);
				} else {
					controller.sendMessage(conn, strings.usernameInUse);
				}
			});
		},
		perform: function(conn, argsArr) {
			//create a new player
			controller.createMUDObject(conn,
				{
					name: argsArr[0],
					password: argsArr[1],
					type:'PLAYER',
					locationId: controller.defaultRoom.id,
					targetId: controller.defaultRoom.id
				}, function(player) {
				if (player) {
					player.setOwner(player).success(function() {
						controller.activatePlayer(conn, player);
						controller.broadcastExcept(conn, strings.hasConnected, player);

						controller.clearScreen(conn);
						commands.look.perform(conn, []);
					});
				}
			});
		}
	}),
	//handle connection of an existing user
	connect: CommandHandler.extend({
		nargs: 2,
		preLogin: true,
		postLogin: false,
		validate: function(conn, argsArr, cb) {
			controller.loadMUDObject(conn, {name: argsArr[0], type:'PLAYER'}, function(player) {
				if (!player) {
					controller.sendMessage(conn, strings.playerNotFound);
					return;
				}

				if (player.password !== argsArr[1]) {
					controller.sendMessage(conn, strings.incorrectPassword);
					return;
				}

				cb(conn, argsArr);
			});
		},
		perform: function(conn, argsArr) {
			//load player if possible:
			controller.loadMUDObject(conn, {name: argsArr[0], password: argsArr[1], type:'PLAYER'}, function(player) {
				if (player) {
					controller.applyToActivePlayers(function(apconn, ap) {
						if (ap.name === argsArr[0]) {
							//player is already connected... kick them off then rejoin them
							controller.deactivatePlayer(apconn);
							return false;
						}
					});

					controller.activatePlayer(conn, player);
					controller.broadcastExcept(conn, strings.hasConnected, player);

					controller.clearScreen(conn);
					commands.look.perform(conn, []);
				}
			});
		}
	}),
	//Disconnect the player
	QUIT: CommandHandler.extend({
		preLogin: true,
		perform: function(conn, argsArr) {
			conn.terminate();
		}
	}),
	//List active players
	WHO: CommandHandler.extend({
		preLogin: true,
		perform: function(conn, argsArr) {
			controller.applyToActivePlayers(function(otherconn, other) {
				if (otherconn !== conn) {
					controller.sendMessage(conn, other.name);
				}
			});
		}
	}),
	//Speak to other players
	say: CommandHandler.extend({
		nargs: 1,
		validate: function(conn, argsArr, cb) {
			cb(conn, argsArr);
		},
		perform: function(conn, argsArr) {
			var message = argsArr.length===0 ? "" : argsArr[0];
			var player = controller.findActivePlayerByConnection(conn);

			controller.sendMessage(conn, strings.youSay, {message: message});
			controller.sendMessageRoomExcept(conn, strings.says, {name: player.name, message: message});
		}
	}),
	//move the player somewhere
	go: CommandHandler.extend({
		nargs: 1,
		validate: function(conn, argsArr, cb) {
			if (argsArr.length === 1) {
				cb(conn, argsArr);
			} else {
				controller.sendMessage(conn, strings.unknownCommand);
			}
		},
		perform: function(conn, argsArr, errMsg) {
			var player = controller.findActivePlayerByConnection(conn);
			var exitName = argsArr[0];

			if (exitName === 'home') {
				player.getTarget().success(function(loc) {
					controller.applyToActivePlayers(function(otherconn, other) {
						if (other.locationId === loc.id && player !== other) {
							controller.sendMessage(otherconn, strings.goesHome, {name: player.name});
						}
					});

					player.getContents().success(function(contents){
						if (contents) {
							var chainer = new db.Sequelize.Utils.QueryChainer();
							for (var i=0; i<contents.length; i++) {
								var ci = contents[i];
								ci.locationId = ci.targetId;
								chainer.add(ci.save());
							}
							chainer.run().success(function(){
								//don't need to do anything
							});
						}

						for (var i=0; i<3; i++)
							controller.sendMessage(conn, strings.noPlaceLikeHome);
						
						player.setLocation(loc).success(function() {
							controller.sendMessage(conn, strings.goneHome);
							commands.look.lookRoom(conn, loc);
						});
					});
				});
			} else {
				controller.findPotentialMUDObject(conn, exitName, function(exit) {
					//found a matching exit... can we use it?
					predicates.canDoIt(controller, player, exit, function(canDoIt) {
						if (canDoIt && exit.targetId) {
							exit.getTarget().success(function(loc) {
								if (loc.id !== player.locationId) {
									//only inform everyone else if its a different room
									controller.applyToActivePlayers(function(otherconn, other) {
										if (other.locationId === player.locationId && player !== other) {
											controller.sendMessage(otherconn, strings.leaves, {name: player.name});
										}
										if (other.locationId === loc.id && player !== other) {
											controller.sendMessage(otherconn, strings.enters, {name: player.name});
										}
									});
								
									player.setLocation(loc).success(function() {
										commands.look.lookRoom(conn, loc);
									});
								} else {
									commands.look.lookRoom(conn, loc);
								}
							});
						}
					}, strings.noGo);
				}, false, false, 'EXIT', strings.ambigGo, errMsg ? errMsg : strings.noGo);
			}
		}
	}),
	//look at something
	look: CommandHandler.extend({
		nargs: 1,
		validate: function(conn, argsArr, cb) {
			if (argsArr.length <= 1)
				cb(conn, argsArr);
			else
				controller.sendMessage(conn, strings.unknownCommand);
		},
		perform: function(conn, argsArr) {
			var player = controller.findActivePlayerByConnection(conn);

			if (argsArr.length === 0 || argsArr[0].length===0) {
				player.getLocation().success(function(room) {
					commands.look.look(conn, room);
				});
			} else {
				controller.findPotentialMUDObject(conn, argsArr[0], function(obj) {
					commands.look.look(conn, obj);
				}, true, true, undefined, undefined, undefined, true);
			}
		},
		look: function(conn, obj) {
			switch (obj.type) {
				case 'ROOM':
					commands.look.lookRoom(conn, obj);
					break;
				case 'PLAYER':
					commands.look.lookSimple(conn, obj);
					commands.look.lookContents(conn, obj, strings.carrying);
					break;
				default:
					commands.look.lookSimple(conn, obj);
			}
		},
		lookRoom: function(conn, room) {
			var player = controller.findActivePlayerByConnection(conn);

			if (predicates.isLinkable(room, player)) {
				controller.sendMessage(conn, strings.roomNameOwner, room);
			} else {
				controller.sendMessage(conn, strings.roomName, room);
			}
			if (room.description) controller.sendMessage(conn, room.description);

			predicates.canDoIt(controller, player, room, function() {
				commands.look.lookContents(conn, room, strings.contents);
			});
		},
		lookSimple: function(conn, obj) {
			controller.sendMessage(conn, obj.description ? obj.description : strings.nothingSpecial);
		},
		lookContents: function(conn, obj, name, fail) {
			obj.getContents().success(function(contents) {
				if (contents) {
					var player = controller.findActivePlayerByConnection(conn);

					contents = contents.filter(function(o) {
						return predicates.canSee(player, o);
					});

					if (contents.length>0) {
						controller.sendMessage(conn, name);
						for (var i=0; i<contents.length; i++) {
							controller.sendMessage(conn, contents[i].name);
						}
					} else {
						if (fail)
							controller.sendMessage(conn, fail);
					}
				} 
			});
		}
	}),

    drop: CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            var hasTempleFlag;
            var hasDropto;

            controller.loadMUDObject(conn, {id: player.locationId}, function(room){
                hasTempleFlag = (room.isTemple()) ? true : false;
                hasDropto = (room.targetId) ? true : false;
                controller.findPotentialMUDObject(conn, argsArr[0], function(object){
                    if (object.locationId === player.id){
                        var chainer = new db.Sequelize.Utils.QueryChainer();
                        if(hasDropto){
                            object.locationId = room.targetId;
                        }else if(hasTempleFlag || (hasTempleFlag && hasDropto)){
                            object.locationId = object.targetId;
                        }else {
                            object.locationId = player.locationId;
                        }
                        chainer.add(object.save());
                        controller.sendMessage(conn, strings.dropped);
                    }else{
                        controller.sendMessage(conn, strings.dontHave);
                    }
                }, false, false, 'THING', undefined, undefined, true);
            });
        }
    }),

    examine: CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if (argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.examineUnknown);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            controller.findPotentialMUDObject(conn, argsArr[0], function(obj){
                if(obj.ownerId === player.id){
                    if(predicates.canSee(player, obj)){
                        controller.sendMessage(conn, strings.examine, obj);
                    }
                }else{
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            }, false, false, undefined, strings.ambigSet, undefined, false);
        }
    }),

    take: CommandHandler.extend({
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.takeUnknown);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);

            controller.findPotentialMUDObject(conn, argsArr[0], function(obj){
                if(obj.hasAntiLock()){
                    controller.loadMUDObject(conn, {id: obj.keyId}, function (theObj){
                        if(theObj.locationId !== player.id || obj.keyId !== player.id){
                            commands.take.action(conn, obj, player);
                        } else{
                            controller.sendMessage(conn, strings.cantTakeThat);
                        }
                    });
                }else{
                    predicates.canDoIt(controller, player, obj, function(canDoIt){
                        if(canDoIt){
                            commands.take.action(conn, obj, player);
                        }else if(obj.locationId === player.id){
                            controller.sendMessage(conn, strings.alreadyHaveThat);
                        }
                    }, strings.cantTakeThat);
                }
            }, false, false, 'THING', undefined, undefined, true);
        },
        action: function(conn, object, player){
            var chainer = new db.Sequelize.Utils.QueryChainer();
            object.locationId = player.id;
            chainer.add(object.save());
            controller.sendMessage(conn, strings.taken);
        }
    }),

    inventory: CommandHandler.extend({
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 0){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommands);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            controller.loadMUDObjects(conn, {locationId: player.id}, function(obj){
                if(obj.length === 0){
                    controller.sendMessage(conn, strings.carryingNothing);
                }else{
                    controller.sendMessage(conn, strings.youAreCarrying);
                    for (var i = 0; i < obj.length; i++){
                        controller.sendMessage(conn, obj[i].name);
                    }
                }
            });
        }
    }),

    page: CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);

            var friend = controller.findActivePlayerByName(argsArr[0]);
            var friendConn = controller.findActiveConnectionByPlayer(friend);

            if(friend && (friend !== player)){
                controller.loadMUDObject(conn, {id: player.locationId}, function(obj){
                    controller.sendMessage(friendConn, strings.page, {name: player.name, location: obj.name});
                });
                controller.sendMessage(conn, strings.pageOK);
            }else{
                controller.sendMessage(conn, strings.isNotAvailable);
            }
        }
    }),

    whisper: CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var index = argsArr[0].indexOf("=");
            index = (index === -1) ? argsArr[0].length : index;
            var targetName = argsArr[0].substring(0, index).trim();
            var message = argsArr[0].substring(index + 1).trim();

            var player = controller.findActivePlayerByConnection(conn);
            var friend = controller.findActivePlayerByName(targetName);
            var connFriend = controller.findActiveConnectionByPlayer(friend);

            if(!friend){
                controller.loadMUDObject(conn, {name: targetName, type: 'PLAYER'}, function(obj){
                    controller.sendMessage(conn, strings.notConnected, {name: obj.name});
                });
            }else{
                if(friend.locationId === player.locationId){
                    if(friend === player){
                        controller.sendMessage(conn, strings.isNotAvailable);
                    }else{
                        controller.sendMessage(conn, strings.youWhisper, {message: message, name: friend.name});
                        controller.sendMessage(connFriend, strings.toWhisper, {name: player.name, message: message});
                        controller.applyToActivePlayers(function(aConn, aPlayer){
                            if(aPlayer.locationId === player.locationId){
                                if(aPlayer !== player && aPlayer !== friend){
                                    var rand = Math.random() * 10;
                                    if(rand < 1){
                                        controller.sendMessage(aConn, strings.overheard, {fromName: player.name, message: message, toName: friend.name});
                                    }else{
                                        controller.sendMessage(aConn, strings.whisper, {fromName: player.name, toName: friend.name});
                                    }
                                }
                            }
                        });
                    }
                }else{
                    controller.sendMessage(conn, strings.notInRoom);
                }
            }
        }
    }),

    "@create": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            if(predicates.isNameValid(argsArr[0])){
                controller.createMUDObject(conn,
                    {
                        name: argsArr[0],
                        type: 'THING',
                        locationId: player.id,
                        ownerId: player.id,
                        targetId: player.targetId
                    }, function(){
                        controller.sendMessage(conn, strings.created);
                    }
                );
            }else{
                controller.sendMessage(conn, strings.invalidName);
            }
        }
    }),

    //set the description of something
    "@describe": PropertyHandler.extend({
        prop: 'description'
    }),

    "@dig": CommandHandler.extend({
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.invalidName);
            }
        },
        perform: function(conn, argsArr){
            controller.createMUDObject(conn,
                {
                    name: argsArr[0],
                    type: 'ROOM',
                    ownerId: controller.findActivePlayerByConnection(conn).id
                }, function(obj){
                    controller.sendMessage(conn, strings.roomCreated, {name: obj.name, id: obj.id});
                }
            );
        }
    }),

    "@failure": PropertyHandler.extend({
        prop: 'failureMessage'
    }),

    "@ofailure": PropertyHandler.extend({
        "prop": 'othersFailureMessage'
    }),

    "@find": CommandHandler.extend({
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);

            controller.loadMUDObjects(conn, {ownerId: player.id}, function(obj){
                for(var i = 0; i < obj.length; i++){
                    var isThere = obj[i].name.toLowerCase().indexOf(argsArr[0].toLowerCase());
                    if(isThere !== -1){
                        controller.sendMessage(conn, obj[i].name);
                    }
                }
            });
        }
    }),

    "@name": PropertyHandler.extend({
        prop: 'name'
    }),

    "@success": PropertyHandler.extend({
        prop: 'successMessage'
    }),

    "@osuccess": PropertyHandler.extend({
        "prop": 'othersSuccessMessage'
    }),

    "@password": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var index = argsArr[0].indexOf("=");
            index = (index === -1) ? argsArr[0].length : index;
            var oldPasswd = argsArr[0].substring(0, index).trim();
            var newPasswd = argsArr[0].substring(index + 1).trim();

            var player = controller.findActivePlayerByConnection(conn);

            if(oldPasswd === player.password && predicates.isPasswordValid(newPasswd)){
                var chainer = new db.Sequelize.Utils.QueryChainer();
                player.password = newPasswd;
                chainer.add(player.save());
                controller.sendMessage(conn, strings.changePasswordSuccess);
            }else{
                controller.sendMessage(conn, strings.changePasswordFail);
            }
        }
    }),

    "@set": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1 && argsArr[0].indexOf("=") > -1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var index;
            var object;
            var setIt = false;
            var resetIt = false;

            if(argsArr[0].indexOf("=") > -1){
                if(argsArr[0].indexOf("=!") > -1){
                    resetIt = true;
                    setIt = false;
                    index = argsArr[0].indexOf("!");
                    object = argsArr[0].substring(0, index - 2);
                }else{
                    setIt = true;
                    resetIt = false;
                    index = argsArr[0].indexOf("=");
                    object = argsArr[0].substring(0, index).trim();
                }
            }

            var flag = argsArr[0].substring(index + 1).trim();

            var player = controller.findActivePlayerByConnection(conn);
            controller.findPotentialMUDObject(conn, object, function(obj){
                if(obj.ownerId === player.id){
                    if(setIt){
                        switch (flag){
                            case "link_ok":
                                obj.setFlag(db.MUDObject.FLAGS.link_ok);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            case "anti_lock":
                                obj.setFlag(db.MUDObject.FLAGS.anti_lock);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            case "temple":
                                obj.setFlag(db.MUDObject.FLAGS.temple);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            default :
                                controller.sendMessage(conn, strings.setUnknown);
                                break;
                        }
                    }else if(resetIt){
                        switch (flag){
                            case "link_ok":
                                obj.resetFlag(db.MUDObject.FLAGS.link_ok);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            case "anti_lock":
                                obj.resetFlag(db.MUDObject.FLAGS.anti_lock);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            case "temple":
                                obj.resetFlag(db.MUDObject.FLAGS.temple);
                                controller.sendMessage(conn, strings.set, {property: obj.name});
                                break;
                            default :
                                controller.sendMessage(conn, strings.setUnknown);
                                break;
                        }
                    }
                }else{
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            }, true, true, undefined, undefined, undefined, false);
        }
    }),

    "@open": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                 cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            controller.loadMUDObject(conn, {id: player.locationId}, function(obj){
                if(obj.ownerId === player.id){
                    if(predicates.isNameValid(argsArr[0])){
                        controller.createMUDObject(conn,
                            {
                                name: argsArr[0],
                                type: 'EXIT',
                                locationId: player.locationId
                            },function(obj){
                                controller.sendMessage(conn, strings.opened);
                            }
                        );
                    }else{
                        controller.sendMessage(conn, strings.invalidName);
                    }
                }else{
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            });
        }
    }),

    "@lock": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.lockUnknown);
            }
        },
        perform: function(conn, argsArr){
            var index = argsArr[0].indexOf("=");
            index = (index === -1) ? argsArr[0].length : index;
            var object = argsArr[0].substring(0, index).trim();
            var key = argsArr[0].substring(index+1).trim();
            var player = controller.findActivePlayerByConnection(conn);

            controller.findPotentialMUDObject(conn, object, function(theObject){
                if(theObject.ownerId === player.id){
                    controller.findPotentialMUDObject(conn, key, function(theKey){
                        var chainer = new db.Sequelize.Utils.QueryChainer();
                        theObject.keyId = theKey.id;
                        chainer.add(theObject.save());
                        controller.sendMessage(conn, strings.locked);
                    }, true, true, undefined, undefined, strings.keyUnknown, false);
                }else{
                    controller.sendMessage(conn, strings.permissionDenied);
                }
            }, true, true, undefined, undefined, strings.lockUnknown, false);
        }
    }),

    "@unlock": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                var player = controller.findActivePlayerByConnection(conn);
                controller.findPotentialMUDObject(conn, argsArr[0], function(obj){
                    if(obj.ownerId === player.id){
                        cb(conn, argsArr);
                    }else{
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                }, true, true, undefined, strings.ambigSet, undefined, true);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },

        perform: function(conn, argsArr){
            controller.findPotentialMUDObject(conn, argsArr[0], function(lockedObj){
                var chainer = new db.Sequelize.Utils.QueryChainer();
                lockedObj.keyId = null;
                chainer.add(lockedObj.save());
                controller.sendMessage(conn, strings.unlocked);
            }, true, true, undefined, strings.ambigSet, undefined, true);
        }
    }),

    "@unlink": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMess(conn, strings.unlinkUnknown);
            }
        },
        perform: function(conn, argsArr){
            var player = controller.findActivePlayerByConnection(conn);
            controller.loadMUDObject(conn, {name: argsArr[0]}, function(exit){
                if(exit.type === 'EXIT'){
                    if(exit.ownerId === player.id){
                        var chainer = new db.Sequelize.Utils.QueryChainer();
                        exit.targetId = null;
                        exit.ownerId = null;
                        chainer.add(exit.save());
                        controller.sendMessage(conn, strings.unlinked);
                    }else{
                        controller.sendMessage(conn, strings.permissionDenied);
                    }
                }else{
                    controller.sendMessage(conn, strings.unlinkUnknown);
                }
            });
        }
    }),

    "@link": CommandHandler.extend({
        nargs: 1,
        validate: function(conn, argsArr, cb){
            if(argsArr.length === 1){
                cb(conn, argsArr);
            }else{
                controller.sendMessage(conn, strings.unknownCommand);
            }
        },
        perform: function(conn, argsArr){
            var index = argsArr[0].indexOf("=");
            index = (index === -1) ? argsArr[0].length : index;
            var currentObject = argsArr[0].substring(0, index).trim();
            var target = argsArr[0].substring(index+1).trim();
            var player = controller.findActivePlayerByConnection(conn);

            controller.findPotentialMUDObject(conn, currentObject, function(obj){
                if(target === 'home' || target === 'here'){
                    if(target === 'home'){
                        if(obj.type === 'ROOM'){
                            player.targetId = player.locationId;
                            controller.sendMessage(conn, strings.set, {property: obj.name});
                        }else{
                            obj.targetId = player.targetId;
                            controller.sendMessage(conn, strings.linked);
                        }
                    }
                    if(target === 'here'){
                        if(obj.type === 'PLAYER'){
                            player.targetId = player.locationId;
                            controller.sendMessage(conn, strings.homeSet);
                        }else{
                            obj.targetId = player.locationId;
                            controller.sendMessage(conn, strings.linked);
                        }
                    }
                    var chainer = new db.Sequelize.Utils.QueryChainer();
                    chainer.add(obj.save());
                }else{
                    controller.loadMUDObject(conn, {id: target}, function(room){
                        if(room){
                            switch (obj.type){
                                case 'EXIT':
                                    if(!obj.targetId){
                                        if(room.ownerId === player.id || predicates.isLinkable(room, player)){
                                            obj.targetId = room.id;
                                            controller.sendMessage(conn, strings.linked);
                                        }else{
                                            controller.sendMessage(conn, strings.permissionDenied);
                                        }
                                    }else{
                                        controller.sendMessage(conn, strings.cantTakeLinkedExit);
                                    }
                                    break;
                                case 'PLAYER':
                                    obj.targetId = room.id;
                                    controller.sendMessage(conn, strings.homeSet);
                                    break;
                                case 'THING':
                                    console.log(obj.ownerId === player.id);
                                    if(obj.ownerId === player.id){
                                        obj.targetId = room.id;
                                        controller.sendMessage(conn, strings.linked);
                                    }else{
                                        controller.sendMessage(conn, strings.permissionDenied);
                                    }
                                    break;
                            }
                        var chainer = new db.Sequelize.Utils.QueryChainer();
                        chainer.add(obj.save());
                    }else{
                        controller.sendMessage(conn, strings.notARoom);
                    }
                    });
                }
            }, true, true, undefined, undefined, undefined, true);
        },
    })
};

//command aliases
commands.goto = commands.go;
commands.move = commands.go;
commands.cr = commands.create;
commands.co = commands.connect;
commands.throw = commands.drop;
commands.get = commands.take;
commands.read = commands.look;
commands["@fail"] = commands["@failure"];
commands["@ofail"] = commands["@ofailure"];
//The commands object is exported publicly by the module
module.exports = commands;
