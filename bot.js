// Require everything
var auth = require('./auth.json');
var config = require('./config.json');
var _ = require('lodash');
var logger = require('winston');
var redis = require("redis");
var request = require('request');
var Discord = require('discord.js');

// Initialize everything
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {colorize: true});
logger.level = 'debug';

var db = new redis.createClient({prefix: 'latte_'});
db.on('error', function (e) {
    logger.error('Redis error: ' + e);
})

var userStates = {};

// Start our Discord instance
var bot = new Discord.Client();

bot.on('ready', function (evt) {
    logger.info('Connected');
    logger.info('Logged in as: ');
    logger.info(bot.user.username + ' - (' + bot.user.id + ')');
    bot.user.setGame(config.botPrefix + 'help for usage');
});

bot.on('message', function (msg) {
    // Our bot needs to know if it will execute a command
    // It will listen for messages that start with config.botPrefix
    if (msg.content.startsWith(config.botPrefix)) {
        var args = msg.content.substring(config.botPrefix.length).split(' ');
        var cmd = args[0];
       
        args = args.splice(1);

        switch(cmd) {
            // Just a pingback
            case 'ping':
                msg.reply('pong!');
                logger.info(msg.author.tag + ' pinged me');
                break;
            
            // Usage info    
            case 'help':
                var commands = [
                    ['help',                          'provides this info page'],
                    ['ping',                          'tells if bot is still alive'],
                    ['aid [channel]',                 'pings the assigned channel helper group to aid you'],
                    ['sub(scribe) [channel]',         'subscribes you into a channel helper group'],
                    ['unsub(scribe) [channel]',       'unsubscribes you from a helper group'],
                    ['desc(ribe) <keywords>',         'searches Wikipedia and provides definition about subject'],
                    ['trans(late) <language> <word>', 'translates a word from language to English']
                ];

                for (var i = 0; i < commands.length; i++) {
                    commands[i] = '`' + config.botPrefix + commands[i][0] + '`: *' + commands[i][1] + '*';
                };

                msg.reply([
                    '**LatteBot - Command usage**',
                    '',
                    '**(**parentheses**)**: part can be omitted, **[**square brackets**]**: argument is optional, **<**angle brackets**>**: argument is mandatory',
                    ''
                ].concat(commands));

                break;

            // Wikipedia search replacement
            case 'desc':
            case 'describe':
                var pageUrl = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&redirects=1&exsentences=5&explaintext=1&exsectionformat=plain&exlimit=1&titles=';
                var searchUrl = 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&namespace=0&limit=5&redirects=resolve&search=';

                // We may have some kind of session open here
                if (msg.author.id in userStates) {
                    args[0] = userStates[msg.author.id][args[0]-1][0];
                }

                // Rotate session variable even if user didn't provide answer
                delete userStates[msg.author.id];

                // First: assume there's a page (or redirect) by this name
                // If there is not, search for the given keyword(s)
                // If no results, ¯\_(ツ)_/¯
                // If one result, get that page and gibe it to the user
                // If moar results, let the user choose
                request({
                    url: pageUrl + encodeURIComponent(_.join(args, ' ')),
                    parse: {json: true},
                }, function (err, res, body) {
                    body = JSON.parse(body);
                    var pageId = Object.keys(body.query.pages)[0];
                    
                    if (pageId === "-1") {
                        // We must do a search and then ask, which of results user wants to retrieve
                        request({
                            url: searchUrl + encodeURIComponent(_.join(args, ' ')),
                            parse: {json: true},
                        }, function (err, res, body) {
                            body = JSON.parse(body);
                            var results = _.zip(body[1], body[2], body[3]);

                            if (results.length === 0) {
                                // No results here, that's easy ":D"
                                msg.reply('no results with this query found. Perhaps try something else?')
                                logger.info(msg.author.tag + ' wants to know about ' + body[0] + ', no definitions found');
                            } else if (results.length === 1) {
                                // Third Wikipedia request on this client here... Adds a bit to the round trip time
                                // But hey! Found a legit page.
                                request({
                                    url: pageUrl + encodeURIComponent(results[0][0]),
                                    parse: {json: true},
                                }, function (err, res, body) {
                                    body = JSON.parse(body);
                                    var content = body.query.pages[pageId];
                                    msg.channel.send('**' + content.title + '**\n\n*' + content.extract + '*\n\nRead more: https://en.wikipedia.org/?curid=' + content.pageid);
                                    logger.info(msg.author.tag + ' wants to know about ' + content.title + ', definition given via search');
                                });
                            } else {
                                // Now we haz to ask a question from user, let's compose it before sending
                                var q = 'Which of these? Write `' + config.botPrefix + 'desc *<number>*` to let me know about result.\n\n';
                                for (var i = 0; i < results.length; i++) {
                                    q += (i+1) + ' - **' + results[i][0] + '**: *' + results[i][1] + '*\n';
                                };

                                q += '\n(or just visit https://en.wikipedia.org/?fulltext=1&search=' + encodeURIComponent(body[0]) + ' for better experience)';

                                msg.channel.send(q)
                                logger.info(msg.author.tag + ' wants to know about ' + body[0] + ', but multiple definitions found');
                                userStates[msg.author.id] = results;
                            }

                        });
                    } else {
                        // Found a page, let's return that
                        var content = body.query.pages[pageId];
                        msg.channel.send('**' + content.title + '**\n\n*' + content.extract + '*\n\nRead more: https://en.wikipedia.org/?curid=' + content.pageid);
                        logger.info(msg.author.tag + ' wanted to know about ' + content.title + ', definition given');
                    }
                });
                break;

            // Subscribing to knowledge lists -> when needed, this bot will @ all list members
            case 'sub':
            case 'subscribe':
                if (args.length === 0) {
                    args[0] = msg.channel.name;
                }

                if (!args[0].match(/^[a-zA-Z0-9_-]{2,100}$/)) {
                    msg.reply('invalid subscription list, we use the same convention as channel names.');
                    logger.info(msg.author.tag + ' tried to subscribe to ambiguous list');
                    break;
                }

                db.sadd(msg.channel.guild.id + '_sub_' + args[0], msg.author.id, function (e, res) {
                    if (res === 1) {
                        msg.reply('you are now added to the *' + args[0] + '* subscription list.')
                        logger.info(msg.author.tag + ' successfully subscribed to ' + args[0]);
                    } else if (res === 0) {
                        msg.reply('you are already in *' + args[0] + '*!');
                        logger.info(msg.author.tag + ' tried to subscribe to ' + args[0] + ' but is already there');
                    } else {
                        logger.warn('Redis: unexpected result: ' + res);
                    }
                });
                break;

            // Complement to subscribing
            case 'unsub':
            case 'unsubscribe':
                if (args.length === 0) {
                    args[0] = msg.channel.name;
                }

                if (!args[0].match(/^[a-zA-Z0-9_-]{2,100}$/)) {
                    msg.reply('invalid subscription list, we use the same convention as channel names.');
                    logger.info(msg.author.tag + ' tried to unsubscribe from ambiguous list');
                    break;
                }

                db.srem(msg.channel.guild.id + '_sub_' + args[0], msg.author.id, function (e, res) {
                    if (res === 1) {
                        msg.reply('you are now removed from the *' + args[0] + '* subscription list.')
                        logger.info(msg.author.tag + ' successfully unsubscribed to ' + args[0]);
                    } else if (res === 0) {
                        msg.reply('you are not in *' + args[0] + '*!');
                        logger.info(msg.author.tag + ' tried to unsubscribe ' + args[0] + ' but isn\'t there');
                    } else {
                        logger.warn('Redis: unexpected result: ' + res);
                    }
                });
                break;

            // The way users can be @'d on demand
            case 'aid':
                if (args.length === 0) {
                    args[0] = msg.channel.name;
                }

                if (!args[0].match(/^[a-zA-Z0-9_-]{2,100}$/)) {
                    msg.reply('invalid subscription list, we use the same convention as channel names.');
                    logger.info(msg.author.tag + ' tried to call aid from ambiguous list');
                    break;
                }

                db.smembers(msg.channel.guild.id + '_sub_' + args[0], function (e, res) {
                    if (res.length === 0) {
                        msg.reply('this list has no subscribers 😞');
                        logger.info(msg.author.tag + ' tried to call aid from unexistant list');
                    } else {
                        msg.channel.send('<@' + msg.author.id + '> calls aid from the *' + args[0] + '*s! Ping <@' + _.join(res, '> <@') + '>!');
                        logger.info(msg.author.tag + ' called aid from ' + args[0] + ', pinged ' + res.length + ' users');
                    }
                });
                break;

            case 'trans':
            case 'translate':
                var tokenUrl = 'https://api.cognitive.microsoft.com/sts/v1.0/issueToken?Subscription-Key=';
                //TODO
                
                break;

            break;
         }
     }
});

bot.login(auth.discord);
