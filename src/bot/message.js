const mathjs = require('mathjs');
const axios = require('axios');
const safeEval = require('safe-eval');
const decode = require('decode-html');
const querystring = require('querystring');
const _ = require('lodash');
const crypto = require('crypto');
const commons = require('./commons');
const gitCommitInfo = require('git-commit-info');
const Entities = require('html-entities').AllHtmlEntities;

import { warning } from './helpers/log';
import { getCountOfCommandUsage } from './helpers/commands/count';
import { getManager, getRepository } from 'typeorm';

import { Alias } from './database/entity/alias';
import { Commands } from './database/entity/commands';
import { Cooldown } from './database/entity/cooldown';
import { EventList } from './database/entity/eventList';
import { User } from './database/entity/user';
import { Price } from './database/entity/price';
import { Rank } from './database/entity/rank';

import oauth from './oauth';
import api from './api';
import tmi from './tmi';
import customvariables from './customvariables';
import spotify from './integrations/spotify';
import songs from './systems/songs';
import Parser from './parser';
import { translate } from './translate';


class Message {
  constructor (message) {
    this.message = Entities.decode(message);
  }

  async global (opts) {
    let variables = {
      game: api.stats.currentGame,
      viewers: api.stats.currentViewers,
      views: api.stats.currentViews,
      followers: api.stats.currentFollowers,
      hosts: api.stats.currentHosts,
      subscribers: api.stats.currentSubscribers,
      bits: api.stats.currentBits,
      title: api.stats.currentTitle
    };
    for (let variable of Object.keys(variables)) {
      const regexp = new RegExp(`\\$${variable}`, 'g');
      this.message = this.message.replace(regexp, variables[variable]);
    }

    const version = _.get(process, 'env.npm_package_version', 'x.y.z');
    this.message = this.message.replace(/\$version/g, version.replace('SNAPSHOT', gitCommitInfo().shortHash || 'SNAPSHOT'));

    const latestFollower = await getManager().createQueryBuilder()
      .select('events').from(EventList, 'events')
      .orderBy('events.timestamp', 'DESC')
      .where('events.event >= :event', { event: 'follow' })
      .getOne();
    this.message = this.message.replace(/\$latestFollower/g, !_.isNil(latestFollower) ? latestFollower.username : 'n/a');

    // latestSubscriber
    const latestSubscriber = await getManager().createQueryBuilder()
      .select('events').from(EventList, 'events')
      .orderBy('events.timestamp', 'DESC')
      .where('events.event >= :event', { event: 'sub' })
      .orWhere('events.event >= :event', { event: 'resub' })
      .orWhere('events.event >= :event', { event: 'subgift' })
      .getOne();
    this.message = this.message.replace(/\$latestSubscriber/g, !_.isNil(latestSubscriber) ? latestSubscriber.username : 'n/a');

    // latestTip, latestTipAmount, latestTipCurrency, latestTipMessage
    const latestTip = await getManager().createQueryBuilder()
      .select('events').from(EventList, 'events')
      .orderBy('events.timestamp', 'DESC')
      .where('events.event >= :event', { event: 'tip' })
      .getOne();
    this.message = this.message.replace(/\$latestTipAmount/g, !_.isNil(latestTip) ? parseFloat(JSON.parse(latestTip.values_json).amount).toFixed(2) : 'n/a');
    this.message = this.message.replace(/\$latestTipCurrency/g, !_.isNil(latestTip) ? JSON.parse(latestTip.values_json).currency : 'n/a');
    this.message = this.message.replace(/\$latestTipMessage/g, !_.isNil(latestTip) ? JSON.parse(latestTip.values_json).message : 'n/a');
    this.message = this.message.replace(/\$latestTip/g, !_.isNil(latestTip) ? JSON.parse(latestTip.values_json).username : 'n/a');

    // latestCheer, latestCheerAmount, latestCheerCurrency, latestCheerMessage
    const latestCheer = await getManager().createQueryBuilder()
      .select('events').from(EventList, 'events')
      .orderBy('events.timestamp', 'DESC')
      .where('events.event >= :event', { event: 'cheer' })
      .getOne();
    this.message = this.message.replace(/\$latestCheerAmount/g, !_.isNil(latestCheer) ? parseInt(JSON.parse(latestCheer.values_json).amount, 10) : 'n/a');
    this.message = this.message.replace(/\$latestCheerMessage/g, !_.isNil(latestCheer) ? JSON.parse(latestCheer.values_json).message : 'n/a');
    this.message = this.message.replace(/\$latestCheer/g, !_.isNil(latestCheer) ? JSON.parse(latestCheer.values_json).username : 'n/a');

    const spotifySong = JSON.parse(spotify.currentSong);
    if (!_.isEmpty(spotifySong) && spotifySong.is_playing && spotifySong.is_enabled) {
      // load spotify format
      const format = spotify.format;
      if (opts.escape) {
        spotifySong.song = spotifySong.song.replace(new RegExp(opts.escape, 'g'), `\\${opts.escape}`);
        spotifySong.artist = spotifySong.artist.replace(new RegExp(opts.escape, 'g'), `\\${opts.escape}`);
      }
      this.message = this.message.replace(/\$spotifySong/g, format.replace(/\$song/g, spotifySong.song).replace(/\$artist/g, spotifySong.artist));
    } else {this.message = this.message.replace(/\$spotifySong/g, translate('songs.not-playing'))};


    if (songs.enabled
        && this.message.includes('$ytSong')
        && Object.values(songs.isPlaying).find(o => o)) {
      let currentSong = _.get(JSON.parse(await songs.currentSong), 'title', translate('songs.not-playing'));
      if (opts.escape) {
        currentSong = currentSong.replace(new RegExp(opts.escape, 'g'), `\\${opts.escape}`);
      }
      this.message = this.message.replace(/\$ytSong/g, currentSong);
    } else {this.message = this.message.replace(/\$ytSong/g, translate('songs.not-playing'))};

    return Entities.decode(this.message);
  }

  async parse (attr) {
    this.message = await this.message; // if is promise

    const random = {
      '(random.online.viewer)': async function () {
        const viewers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .andWhere('user.isOnline = :isOnline', { isOnline: true })
          .cache(true)
          .getMany())
          .filter(o => {
            return !commons.isIgnored({ username: o.username, userId: o.userId });
          });
        if (viewers.length === 0) {return 'unknown'};
        return _.sample(viewers.map(o => o.username ));
      },
      '(random.online.follower)': async function () {
        const followers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .andWhere('user.isFollower = :isFollower', { isFollower: true })
          .andWhere('user.isOnline = :isOnline', { isOnline: true })
          .cache(true)
          .getMany()).filter(o => {
          return !commons.isIgnored({ username: o.username, userId: o.userId });
        });
        if (followers.length === 0) {return 'unknown'};
        return _.sample(followers.map(o => o.username ));
      },
      '(random.online.subscriber)': async function () {
        const subscribers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .andWhere('user.isSubscriber = :isSubscriber', { isSubscriber: true })
          .andWhere('user.isOnline = :isOnline', { isOnline: true })
          .cache(true)
          .getMany()).filter(o => {
          return !commons.isIgnored({ username: o.username, userId: o.userId });
        });
        if (subscribers.length === 0) {return 'unknown'};
        return _.sample(subscribers.map(o => o.username ));
      },
      '(random.viewer)': async function () {
        const viewers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .cache(true)
          .getMany()).filter(o => {
          return !commons.isIgnored({ username: o.username, userId: o.userId });
        });
        if (viewers.length === 0) {return 'unknown'};
        return _.sample(viewers.map(o => o.username ));
      },
      '(random.follower)': async function () {
        const followers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .andWhere('user.isFollower = :isFollower', { isFollower: true })
          .cache(true)
          .getMany()).filter(o => {
          return !commons.isIgnored({ username: o.username, userId: o.userId });
        });
        if (followers.length === 0) {return 'unknown'};
        return _.sample(followers.map(o => o.username ));
      },
      '(random.subscriber)': async function () {
        const subscribers = (await getRepository(User).createQueryBuilder('user')
          .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
          .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
          .andWhere('user.isSubscriber = :isSubscriber', { isSubscriber: true })
          .cache(true)
          .getMany()).filter(o => {
          return !commons.isIgnored({ username: o.username, userId: o.userId });
        });
        if (subscribers.length === 0) {return 'unknown'};
        return _.sample(subscribers.map(o => o.username ));
      },
      '(random.number-#-to-#)': async function (filter) {
        let numbers = filter.replace('(random.number-', '')
          .replace(')', '')
          .split('-to-');

        try {
          let lastParamUsed = 0;
          for (let index in numbers) {
            if (!_.isFinite(parseInt(numbers[index], 10))) {
              let param = attr.param.split(' ');
              if (_.isNil(param[lastParamUsed])) {return 0};

              numbers[index] = param[lastParamUsed];
              lastParamUsed++;
            }
          }
          return _.random(numbers[0], numbers[1]);
        } catch (e) {
          return 0;
        }
      },
      '(random.true-or-false)': async function () {
        return Math.random() < 0.5;
      }
    };
    let custom = {
      '$_#': async (variable) => {
        if (!_.isNil(attr.param) && attr.param.length !== 0) {
          let state = await customvariables.setValueOf(variable, attr.param, { sender: attr.sender });
          if (state.updated.responseType === 0) {
            // default
            if (state.isOk && !state.isEval) {
              let msg = await commons.prepare('filters.setVariable', { value: state.setValue, variable: variable });
              commons.sendMessage(msg, attr.sender, { skip: true, quiet: _.get(attr, 'quiet', false) });
            }
            return state.updated.currentValue;
          } else if (state.updated.responseType === 1) {
            // custom
            commons.sendMessage(state.updated.responseText.replace('$value', state.setValue), attr.sender, { skip: true, quiet: _.get(attr, 'quiet', false) });
            return '';
          } else {
            // command
            return state.updated.currentValue;
          }
        }
        return customvariables.getValueOf(variable, { sender: attr.sender, param: attr.param });
      },
      // force quiet variable set
      '$!_#': async (variable) => {
        variable = variable.replace('$!_', '$_');
        if (!_.isNil(attr.param) && attr.param.length !== 0) {
          let state = await customvariables.setValueOf(variable, attr.param, { sender: attr.sender });
          return state.updated.currentValue;
        }
        return customvariables.getValueOf(variable, { sender: attr.sender, param: attr.param });
      },
      // force full quiet variable
      '$!!_#': async (variable) => {
        variable = variable.replace('$!!_', '$_');
        if (!_.isNil(attr.param) && attr.param.length !== 0) {
          await customvariables.setValueOf(variable, attr.param, { sender: attr.sender });
        }
        return '';
      }
    };
    let param = {
      '$touser': async function (filter) {
        if (typeof attr.param !== 'undefined') {
          attr.param = attr.param.replace('@', '');
          if (attr.param.length > 0) {
            if (tmi.showWithAt) {
              attr.param = '@' + attr.param;
            }
            return attr.param;
          }
        }
        return (tmi.showWithAt ? '@' : '') + attr.sender.username;
      },
      '$param': async function (filter) {
        if (!_.isUndefined(attr.param) && attr.param.length !== 0) {return attr.param};
        return '';
      },
      '$!param': async function (filter) {
        if (!_.isUndefined(attr.param) && attr.param.length !== 0) {return attr.param};
        return 'n/a';
      }
    };
    let qs = {
      '$querystring': async function (filter) {
        if (!_.isUndefined(attr.param) && attr.param.length !== 0) {return querystring.escape(attr.param)};
        return '';
      },
      '(url|#)': async function (filter) {
        try {
          return encodeURI(/\(url\|(.*)\)/g.exec(filter)[1]);
        } catch (e) {
          return '';
        }
      }
    };
    let info = {
      '$toptip.#.#': async function (filter) {
        const match = filter.match(/\$toptip\.(?<type>overall|stream)\.(?<value>username|amount|message|currency)/);
        if (!match) {
          return '';
        }

        let tips = (await getManager().createQueryBuilder()
          .select('events').from(EventList, 'events')
          .orderBy('events.timestamp', 'DESC')
          .where('events.event >= :event', { event: 'tip' })
          .getMany())

          .sort((a, b) => {
            const aTip = currency.exchange(a.amount, a.currency, currency.mainCurrency);
            const bTip = currency.exchange(b.amount, b.currency, currency.mainCurrency);
            return bTip - aTip;
          }, 0);

        if (match.groups.type === 'stream') {
          const whenOnline = api.isStreamOnline ? api.streamStatusChangeSince : null;
          if (whenOnline) {
            tips = tips.filter((o) => o.timestamp >= (new Date(whenOnline)).getTime());
          } else {
            return '';
          }
        }

        if (tips.length > 0) {
          if (match.groups.value === 'amount') {
            return Number(tips[0][match.groups.value]).toFixed(2);
          } else {
            return tips[0][match.groups.value];
          }
        }
        return '';
      },
      '(game)': async function (filter) {
        return api.stats.currentGame || 'n/a';
      },
      '(status)': async function (filter) {
        return api.stats.currentTitle || 'n/a';
      }
    };
    let command = {
      '$count(\'#\')': async function (filter) {
        const countRegex = new RegExp('\\$count\\(\\\'(?<command>\\!\\S*)\\\'\\)', 'gm');
        let match = countRegex.exec(filter);
        if (match && match.groups) {
          return String(await getCountOfCommandUsage(match.groups.command));
        }
        return '0';
      },
      '$count': async function (filter) {
        if (attr.cmd) {
          return String((await getCountOfCommandUsage(attr.cmd)));
        }
        return '0';
      },
      '(!!#)': async function (filter) {
        const cmd = filter
          .replace('!', '') // replace first !
          .replace(/\(|\)/g, '')
          .replace(/\$sender/g, (tmi.showWithAt ? '@' : '') + attr.sender.username)
          .replace(/\$param/g, attr.param);
        const parse = new Parser({ sender: attr.sender, message: cmd, skip: true, quiet: true });
        await parse.process();
        return '';
      },
      '(!#)': async function (filter) {
        const cmd = filter
          .replace(/\(|\)/g, '')
          .replace(/\$sender/g, (tmi.showWithAt ? '@' : '') + attr.sender.username)
          .replace(/\$param/g, attr.param);
        const parse = new Parser({ sender: attr.sender, message: cmd, skip: true, quiet: false });
        await parse.process();
        return '';
      }
    };
    let price = {
      '(price)': async function (filter) {
        let price = 0;
        if (price.enabled) {
          let command = await getRepository(Price).findOne({ command: attr.cmd });
          price = command?.price ?? 0;
        }
        return [price, await points.getPointsName(price)].join(' ');
      }
    };
    let online = {
      '(onlineonly)': async function (filter) {
        return api.isStreamOnline;
      },
      '(offlineonly)': async function (filter) {
        return !(api.isStreamOnline);
      }
    };
    let list = {
      '(list.#)': async function (filter) {
        let [system, permission] = filter.replace('(list.', '').replace(')', '').split('.');

        let [alias, commands, cooldowns, ranks, prices] = await Promise.all([
          getRepository(Alias).find({ where: { visible: true, enabled: true } }),
          getRepository(Commands).find({ relations: ['responses'], where: { visible: true, enabled: true } }),
          getRepository(Cooldown).find({ where: { enabled: true } }),
          getRepository(Rank).find(),
          getRepository(Price).find({ where: { enabled: true } })
        ]);

        switch (system) {
          case 'alias':
            return _.size(alias) === 0 ? ' ' : (_.map(alias, (o) => o.alias.replace('!', ''))).sort().join(', ');
          case '!alias':
            return _.size(alias) === 0 ? ' ' : (_.map(alias, 'alias')).sort().join(', ');
          case 'command':
            if (permission) {
              const responses = commands.map(o => o.responses).flat();
              const _permission = await permissions.get(permission);
              if (_permission) {
                const commandIds = responses.filter((o) => o.permission === _permission.id).map((o) => o.cid);
                commands = commands.filter((o) => commandIds.includes(o.id));
              } else {
                commands = [];
              }
            }
            return _.size(commands) === 0 ? ' ' : (_.map(commands, (o) => o.command.replace('!', ''))).sort().join(', ');
          case '!command':
            if (permission) {
              const responses = commands.map(o => o.responses).flat();
              const _permission = await permissions.get(permission);
              if (_permission) {
                const commandIds = responses.filter((o) => o.permission === _permission.id).map((o) => o.cid);
                commands = commands.filter((o) => commandIds.includes(o.id));
              } else {
                commands = [];
              }
            }
            return _.size(commands) === 0 ? ' ' : (_.map(commands, 'command')).sort().join(', ');
          case 'cooldown':
            list = _.map(cooldowns, function (o, k) {
              const time = o.miliseconds;
              return o.name + ': ' + (parseInt(time, 10) / 1000) + 's';
            }).sort().join(', ');
            return list.length > 0 ? list : ' ';
          case 'price':
            list = (await Promise.all(
              _.map(prices, async (o) => {
                return `${o.command} (${o.price}${await points.getPointsName(o.price)})`;
              })
            )).join(', ');
            return list.length > 0 ? list : ' ';
          case 'ranks':
            list = _.map(_.orderBy(ranks, 'hours', 'asc'), (o) => {
              return `${o.rank} (${o.hours}h)`;
            }).join(', ');
            return list.length > 0 ? list : ' ';
          default:
            warning('unknown list system ' + system);
            return '';
        }
      }
    };
    let math = {
      '(math.#)': async function (filter) {
        let toEvaluate = filter.replace(/\(math./g, '').replace(/\)/g, '');

        // check if custom variables are here
        const regexp = /(\$_\w+)/g;
        let match = toEvaluate.match(regexp);
        if (match) {
          for (let variable of match) {
            const currentValue = await customvariables.getValueOf(variable);
            toEvaluate = toEvaluate.replace(
              variable,
              isNaN(Number(currentValue)) ? 0 : currentValue
            );
          }
        }
        return mathjs.evaluate(toEvaluate);
      }
    };
    let evaluate = {
      '(eval#)': async function (filter) {
        let toEvaluate = filter.replace('(eval ', '').slice(0, -1);

        const containUsers = !_.isNil(toEvaluate.match(/users/g));
        const containRandom = !_.isNil(toEvaluate.replace(/Math\.random|_\.random/g, '').match(/random/g));
        const containOnline = !_.isNil(toEvaluate.match(/online/g));
        const containUrl = !_.isNil(toEvaluate.match(/url\(['"](.*?)['"]\)/g));

        let urls = [];
        if (containUrl) {
          for (let match of toEvaluate.match(/url\(['"](.*?)['"]\)/g)) {
            const id = 'url' + crypto.randomBytes(64).toString('hex').slice(0, 5);
            const url = match.replace(/url\(['"]|["']\)/g, '');
            let response = await axios.get(url);
            try {
              response.data = JSON.parse(response.data.toString());
            } catch (e) {
              // JSON failed, treat like string
              response = response.data.toString();
            }
            urls.push({ id, response });
            toEvaluate = toEvaluate.replace(match, id);
          }
        }

        let users = [];
        if (containUsers || containRandom) {
          users = await users.getAll();
        }
        let user = await users.get(attr.sender.username);

        let onlineViewers = [];
        let onlineSubscribers = [];
        let onlineFollowers = [];

        if (containOnline) {
          const viewers = (await getRepository(User).createQueryBuilder('user')
            .where('user.username != :botusername', { botusername: oauth.botUsername.toLowerCase() })
            .andWhere('user.username != :broadcasterusername', { broadcasterusername: oauth.broadcasterUsername.toLowerCase() })
            .andWhere('user.isOnline = :isOnline', { isOnline: true })
            .getMany()).filter(o => {
            return commons.isIgnored({ username: o.username, userId: o.userId });
          });

          onlineViewers = viewers;
          onlineSubscribers = viewers.filter(o => o.isSubscriber);
          onlineFollowers = viewers.filter(o => o.isFollower);
        }

        let randomVar = {
          online: {
            viewer: _.sample(_.map(onlineViewers, 'username')),
            follower: _.sample(_.map(onlineFollowers, 'username')),
            subscriber: _.sample(_.map(onlineSubscribers, 'username'))
          },
          viewer: _.sample(_.map(users, 'username')),
          follower: _.sample(_.map(_.filter(users, (o) => _.get(o, 'is.follower', false)), 'username')),
          subscriber: _.sample(_.map(_.filter(users, (o) => _.get(o, 'is.subscriber', false)), 'username'))
        };
        let is = user.is;

        let toEval = `(function evaluation () {  ${toEvaluate} })()`;
        let context = {
          _: _,
          users: users,
          is: is,
          random: randomVar,
          sender: tmi.showWithAt ? `@${attr.sender.username}` : `${attr.sender.username}`,
          param: _.isNil(attr.param) ? null : attr.param
        };

        if (containUrl) {
          // add urls to context
          for (let url of urls) {
            context[url.id] = url.response;
          }
        }

        return (safeEval(toEval, context));
      }
    };
    let ifp = {
      '(if#)': async function (filter) {
        // (if $days>2|More than 2 days|Less than 2 days)
        try {
          let toEvaluate = filter
            .replace('(if ', '')
            .slice(0, -1)
            .replace(/\$param|\$!param/g, attr.param); // replace params
          let [check, ifTrue, ifFalse] = toEvaluate.split('|');
          check = check.startsWith('>') || check.startsWith('<') || check.startsWith('=') ? false : check; // force check to false if starts with comparation
          if (_.isNil(ifTrue)) {return};
          if (safeEval(check)) {return ifTrue};
          return _.isNil(ifFalse) ? '' : ifFalse;
        } catch (e) {
          return '';
        }
      }
    };
    let stream = {
      '(stream|#|game)': async function (filter) {
        const channel = filter.replace('(stream|', '').replace('|game)', '');

        const token = await oauth.botAccessToken;
        if (token === '') {return 'n/a'};

        try {
          let request = await axios.get(`https://api.twitch.tv/kraken/users?login=${channel}`, {
            headers: {
              'Accept': 'application/vnd.twitchtv.v5+json',
              'Authorization': 'OAuth ' + token
            }
          });
          const channelId = request.data.users[0]._id;
          request = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${channelId}`, {
            headers: {
              'Authorization': 'Bearer ' + token
            }
          });
          return api.getGameFromId(request.data.data[0].game_id);
        } catch (e) { return 'n/a'; } // return nothing on error
      },
      '(stream|#|title)': async function (filter) {
        const channel = filter.replace('(stream|', '').replace('|title)', '');

        const token = await oauth.botAccessToken;
        if (token === '') {return 'n/a'};

        try {
          let request = await axios.get(`https://api.twitch.tv/kraken/users?login=${channel}`, {
            headers: {
              'Accept': 'application/vnd.twitchtv.v5+json',
              'Authorization': 'OAuth ' + token
            }
          });

          const channelId = request.data.users[0]._id;
          request = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${channelId}`, {
            headers: {
              'Authorization': 'Bearer ' + token
            }
          });
          // save remaining api calls
          api.calls.bot.remaining = request.headers['ratelimit-remaining'];
          api.calls.bot.refresh = request.headers['ratelimit-reset'];
          return request.data.data[0].title;
        } catch (e) { return 'n/a'; } // return nothing on error
      },
      '(stream|#|viewers)': async function (filter) {
        const channel = filter.replace('(stream|', '').replace('|viewers)', '');

        const token = await oauth.botAccessToken;
        if (token === '') {return '0'};

        try {
          let request = await axios.get(`https://api.twitch.tv/kraken/users?login=${channel}`, {
            headers: {
              'Accept': 'application/vnd.twitchtv.v5+json',
              'Authorization': 'OAuth ' + token
            }
          });
          const channelId = request.data.users[0]._id;
          request = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${channelId}`, {
            headers: {
              'Authorization': 'Bearer ' + token
            }
          });
          // save remaining api calls
          api.calls.bot.remaining = request.headers['ratelimit-remaining'];
          api.calls.bot.refresh = request.headers['ratelimit-reset'];
          return request.data.data[0].viewer_count;
        } catch (e) { return '0'; } // return nothing on error
      }
    };

    await this.global({});

    await this.parseMessageEach(price);
    await this.parseMessageEach(info);
    await this.parseMessageEach(random);
    await this.parseMessageEach(ifp, false);
    await this.parseMessageVariables(custom);
    await this.parseMessageEval(evaluate, decode(this.message));
    await this.parseMessageEach(param, true);
    // local replaces
    if (!_.isNil(attr)) {
      for (let [key, value] of Object.entries(attr)) {
        if (_.includes(['sender'], key)) {
          if (typeof value.username !== 'undefined') {
            value = tmi.showWithAt ? `@${value.username}` : value.username;
          } else {
            value = tmi.showWithAt ? `@${value}` : value;
          }
        }
        this.message = this.message.replace(new RegExp('[$]' + key, 'g'), value);
      }
    }
    await this.parseMessageEach(math);
    await this.parseMessageOnline(online);
    await this.parseMessageCommand(command);
    await this.parseMessageEach(qs, false);
    await this.parseMessageEach(list);
    await this.parseMessageEach(stream);
    await this.parseMessageApi();

    return this.message;
  }

  async parseMessageApi () {
    if (this.message.trim().length === 0) {return};

    let rMessage = this.message.match(/\(api\|(http\S+)\)/i);
    if (!_.isNil(rMessage) && !_.isNil(rMessage[1])) {
      this.message = this.message.replace(rMessage[0], '').trim(); // remove api command from message
      let url = rMessage[1].replace(/&amp;/g, '&');
      let response = await axios.get(url);
      if (response.status !== 200) {
        return translate('core.api.error');
      }

      // search for api datas in this.message
      let rData = this.message.match(/\(api\.(?!_response)(\S*?)\)/gi);
      if (_.isNil(rData)) {
        if (_.isObject(response.data)) {
          // Stringify object
          this.message = this.message.replace('(api._response)', JSON.stringify(response.data));
        } else {this.message = this.message.replace('(api._response)', response.data.toString().replace(/^"(.*)"/, '$1'))};
      } else {
        if (_.isBuffer(response.data)) {response.data = JSON.parse(response.data.toString())};
        for (let tag of rData) {
          let path = response.data;
          let ids = tag.replace('(api.', '').replace(')', '').split('.');
          _.each(ids, function (id) {
            let isArray = id.match(/(\S+)\[(\d+)\]/i);
            if (isArray) {
              path = path[isArray[1]][isArray[2]];
            } else {
              path = path[id];
            }
          });
          this.message = this.message.replace(tag, !_.isNil(path) ? path : translate('core.api.not-available'));
        }
      }
    }
  }

  async parseMessageCommand (filters) {
    if (this.message.trim().length === 0) {return};
    for (var key in filters) {
      if (!filters.hasOwnProperty(key)) {continue};

      let fnc = filters[key];
      let regexp = _.escapeRegExp(key);

      // we want to handle # as \w - number in regexp
      regexp = regexp.replace(/#/g, '.*?');
      let rMessage = this.message.match((new RegExp('(' + regexp + ')', 'g')));
      if (!_.isNull(rMessage)) {
        for (var bkey in rMessage) {
          this.message = this.message.replace(rMessage[bkey], await fnc(rMessage[bkey])).trim();
        }
      }
    }
  }

  async parseMessageOnline (filters) {
    if (this.message.trim().length === 0) {return};
    for (var key in filters) {
      if (!filters.hasOwnProperty(key)) {continue};

      let fnc = filters[key];
      let regexp = _.escapeRegExp(key);

      // we want to handle # as \w - number in regexp
      regexp = regexp.replace(/#/g, '(\\S+)');
      let rMessage = this.message.match((new RegExp('(' + regexp + ')', 'g')));
      if (!_.isNull(rMessage)) {
        for (var bkey in rMessage) {
          if (!(await fnc(rMessage[bkey]))) {
            this.message = '';
          } else {
            this.message = this.message.replace(rMessage[bkey], '').trim();
          }
        }
      }
    }
  }

  async parseMessageEval (filters) {
    if (this.message.trim().length === 0) {return};
    for (var key in filters) {
      if (!filters.hasOwnProperty(key)) {continue};

      let fnc = filters[key];
      let regexp = _.escapeRegExp(key);

      // we want to handle # as \w - number in regexp
      regexp = regexp.replace(/#/g, '([\\S ]+)');
      let rMessage = this.message.match((new RegExp('(' + regexp + ')', 'g')));
      if (!_.isNull(rMessage)) {
        for (var bkey in rMessage) {
          let newString = await fnc(rMessage[bkey]);
          if (_.isUndefined(newString) || newString.length === 0) {this.message = ''};
          this.message = this.message.replace(rMessage[bkey], newString).trim();
        }
      }
    }
  }

  async parseMessageVariables (filters, removeWhenEmpty) {
    if (_.isNil(removeWhenEmpty)) {removeWhenEmpty = true};

    if (this.message.trim().length === 0) {return};
    for (var key in filters) {
      if (!filters.hasOwnProperty(key)) {continue};

      let fnc = filters[key];
      let regexp = _.escapeRegExp(key);

      regexp = regexp.replace(/#/g, '([a-zA-Z0-9_]+)');
      let rMessage = this.message.match((new RegExp('(' + regexp + ')', 'g')));
      if (!_.isNull(rMessage)) {
        for (var bkey in rMessage) {
          let newString = await fnc(rMessage[bkey]);
          if ((_.isNil(newString) || newString.length === 0) && removeWhenEmpty) {this.message = ''};
          this.message = this.message.replace(rMessage[bkey], newString).trim();
        }
      }
    }
  }

  async parseMessageEach (filters, removeWhenEmpty) {
    if (_.isNil(removeWhenEmpty)) {removeWhenEmpty = true};

    if (this.message.trim().length === 0) {return};
    for (var key in filters) {
      if (!filters.hasOwnProperty(key)) {continue};

      let fnc = filters[key];
      let regexp = _.escapeRegExp(key);

      if (key.startsWith('$')) {
        regexp = regexp.replace(/#/g, '(\\b.+?\\b)');
      } else {
        regexp = regexp.replace(/#/g, '([\\S ]+?)'); // default behavior for if
      }
      let rMessage = this.message.match((new RegExp('(' + regexp + ')', 'g')));
      if (!_.isNull(rMessage)) {
        for (var bkey in rMessage) {
          let newString = await fnc(rMessage[bkey]);
          if ((_.isNil(newString) || newString.length === 0) && removeWhenEmpty) {this.message = ''};
          this.message = this.message.replace(rMessage[bkey], newString).trim();
        }
      }
    }
  }
}

export { Message };
export default Message;
