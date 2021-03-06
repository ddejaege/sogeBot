import io from 'socket.io-client';
import chalk from 'chalk';

import Integration from './_interface';
import { settings, ui } from '../decorators';
import { onChange, onStartup } from '../decorators/on';
import { info, tip } from '../helpers/log';
import { triggerInterfaceOnTip } from '../helpers/interface/triggers';
import { getRepository } from 'typeorm';
import { User, UserTipInterface } from '../database/entity/user';
import users from '../users';
import events from '../events';
import alerts from '../registries/alerts';

/* example payload (eventData)
{
  _id: '5d967959cd89a10ce12818ad',
  channel: '5afbafb0c3a79ebedde18249',
  event: 'tip',
  provider: 'twitch',
  createdAt: '2019-10-03T22:42:33.023Z',
  data: {
    tipId: '5d967959531876d2589dd772',
    username: 'qwe',
    amount: 12,
    currency: 'RUB',
    message: 'saaaaaaa',
    items: [],
    avatar: 'https://static-cdn.jtvnw.net/user-default-pictures-uv/ebe4cd89-b4f4-4cd9-adac-2f30151b4209-profile_image-300x300.png'
  },
  updatedAt: '2019-10-03T22:42:33.023Z'
} */
class StreamElements extends Integration {
  socketToStreamElements: SocketIOClient.Socket | null = null;

  @settings()
  @ui({ type: 'text-input', secret: true })
  jwtToken = '';

  @onStartup()
  @onChange('enabled')
  onStateChange (key: string, val: boolean) {
    if (val) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  async disconnect () {
    if (this.socketToStreamElements !== null) {
      this.socketToStreamElements.removeAllListeners();
      this.socketToStreamElements.disconnect();
    }
  }

  @onChange('jwtToken')
  async connect () {
    this.disconnect();

    if (this.jwtToken.trim() === '' || !this.enabled) {
      return;
    }

    this.socketToStreamElements = io.connect('https://realtime.streamelements.com', {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      transports: ['websocket'],
    });

    this.socketToStreamElements.on('reconnect_attempt', () => {
      info(chalk.yellow('STREAMELEMENTS:') + ' Trying to reconnect to service');
    });

    this.socketToStreamElements.on('connect', () => {
      info(chalk.yellow('STREAMELEMENTS:') + ' Successfully connected socket to service');
      if (this.socketToStreamElements !== null) {
        this.socketToStreamElements.emit('authenticate', { method: 'jwt', token: this.jwtToken });
      }
    });

    this.socketToStreamElements.on('authenticated', () => {
      info(chalk.yellow('STREAMELEMENTS:') + ' Successfully authenticated on service');
    });

    this.socketToStreamElements.on('disconnect', () => {
      info(chalk.yellow('STREAMELEMENTS:') + ' Socket disconnected from service');
      if (this.socketToStreamElements) {
        this.socketToStreamElements.open();
      }
    });

    this.socketToStreamElements.on('event', async (eventData) => {
      this.parse(eventData);
    });
  }

  async parse(eventData) {
    if (eventData.type !== 'tip') {
      return;
    }

    const { username, amount, currency, message } = eventData.data;

    const getUser = async (username, id) => {
      const userByUsername = await getRepository(User).findOne({ where: { username: username.toLowerCase() }});
      if (userByUsername) {
        return userByUsername;
      }

      const user = await getRepository(User).findOne({ where: { userId: id }});
      if (user) {
        return user;
      } else {
        return getRepository(User).save({
          userId: Number(id),
          username: username.toLowerCase(),
        });
      }
    };

    const user = await getUser(username, await users.getIdByName(username.toLowerCase()));
    const newTip: UserTipInterface = {
      amount: Number(amount),
      currency: currency,
      sortAmount: currency.exchange(Number(amount), currency, 'EUR'),
      message: message,
      tippedAt: Date.now(),
    };
    user.tips.push(newTip);
    getRepository(User).save(user);

    tip(`${username.toLowerCase()}${user.userId ? '#' + user.userId : ''}, amount: ${Number(eventData.data.amount).toFixed(2)}${eventData.data.currency}, message: ${eventData.data.message}`);
    events.fire('tip', {
      username: username.toLowerCase(),
      amount: parseFloat(eventData.data.amount).toFixed(2),
      currency: eventData.data.currency,
      amountInBotCurrency: parseFloat(currency.exchange(eventData.data.amount, eventData.data.currency, currency.mainCurrency)).toFixed(2),
      currencyInBot: currency.mainCurrency,
      message: eventData.data.message,
    });
    alerts.trigger({
      event: 'tips',
      name: username.toLowerCase(),
      amount: Number(parseFloat(eventData.data.amount).toFixed(2)),
      currency: eventData.data.currency,
      monthsName: '',
      message: eventData.data.message,
      autohost: false,
    });

    triggerInterfaceOnTip({
      username: username.toLowerCase(),
      amount: eventData.data.amount,
      message: eventData.data.message,
      currency: eventData.data.currency,
      timestamp: Date.now(),
    });
  }
}

export default new StreamElements();