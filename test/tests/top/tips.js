/* global describe it before */
const commons = require('../../../dest/commons');


require('../../general.js');

const db = require('../../general.js').db;
const message = require('../../general.js').message;

const { getRepository } = require('typeorm');
const { User, UserTip } = require('../../../dest/database/entity/user');

const tmi = (require('../../../dest/tmi')).default;
const top = (require('../../../dest/systems/top')).default;

// users
const owner = { username: 'soge__' };

describe('Top - !top tips', () => {
  before(async () => {
    await db.cleanup();
    await message.prepare();
  });

  it ('Add 10 users into db and last user will don\'t have any tips', async () => {
    for (let i = 0; i < 10; i++) {
      const user = {
        tips: [],
        ...await getRepository(User).save({ userId: Math.floor(Math.random() * 100000), username: 'user' + i }),
      };

      if (i === 0) {
        continue;
      }

      for (let j = 0; j <= i; j++) {
        user.tips.push({
          amount: j,
          sortAmount: j,
          currency: 'EUR',
          message: 'test',
          timestamp: Date.now(),
        });
      }

      await getRepository(User).save(user);
    }
  });

  it('run !top tips and expect correct output', async () => {
    top.tips({ sender: { username: commons.getOwner() } });
    await message.isSentRaw('Top 10 (tips): 1. @user9 - 45.00€, 2. @user8 - 36.00€, 3. @user7 - 28.00€, 4. @user6 - 21.00€, 5. @user5 - 15.00€, 6. @user4 - 10.00€, 7. @user3 - 6.00€, 8. @user2 - 3.00€, 9. @user1 - 1.00€', owner);
  });

  it('add user1 to ignore list', async () => {
    tmi.ignoreAdd({ sender: owner, parameters: 'user1' });
    await message.isSent('ignore.user.is.added', owner, { username: 'user1' });
  });

  it('run !top tips and expect correct output', async () => {
    top.tips({ sender: { username: commons.getOwner() } });
    await message.isSentRaw('Top 10 (tips): 1. @user9 - 45.00€, 2. @user8 - 36.00€, 3. @user7 - 28.00€, 4. @user6 - 21.00€, 5. @user5 - 15.00€, 6. @user4 - 10.00€, 7. @user3 - 6.00€, 8. @user2 - 3.00€', owner);
  });
});
