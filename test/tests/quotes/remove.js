/* eslint-disable @typescript-eslint/no-var-requires */
/* global describe it before */


require('../../general.js');

const db = require('../../general.js').db;
const assert = require('chai').assert;
const message = require('../../general.js').message;

const { getManager } = require('typeorm');
const { Quotes } = require('../../../dest/database/entity/quotes');

const quotes = (require('../../../dest/systems/quotes')).default;

// users
const owner = { username: 'soge__', userId: 1 };


const tests = [
  { sender: owner, parameters: '', shouldFail: true },
  { sender: owner, parameters: '-id', shouldFail: true },
  { sender: owner, parameters: '-id a', id: 'a', shouldFail: true, exist: false },
  { sender: owner, parameters: '-id cb286f64-833d-497f-b5d9-a2dbd7645147', id: 'cb286f64-833d-497f-b5d9-a2dbd7645147', shouldFail: false, exist: false },
  { sender: owner, parameters: '-id $id', id: 1, shouldFail: false, exist: true },
];

describe('Quotes - remove()', () => {
  for (const test of tests) {
    describe(test.parameters, async () => {
      let id = null;

      before(async () => {
        await db.cleanup();
        await message.prepare();
        const quote = await quotes.add({ sender: test.sender, parameters: '-tags lorem ipsum -quote Lorem Ipsum', command: '!quote add' });
        id = quote.id;
        if (test.id === 1) {
          test.id = id;
        }
      });

      it('Run !quote remove', async () => {
        quotes.remove({ sender: test.sender, parameters: test.parameters.replace('$id', id), command: '!quote remove' });
      });
      if (test.shouldFail) {
        it('Should throw error', async () => {
          await message.isSent('systems.quotes.remove.error', owner, { command: '!quote remove' });
        });
        it('Database should not be empty', async () => {
          const items = await getManager()
            .createQueryBuilder()
            .select('quotes')
            .from(Quotes, 'quotes')
            .getMany();
          assert.isNotEmpty(items);
        });
      } else {
        if (test.exist) {
          it('Should sent success message', async () => {
            await message.isSent('systems.quotes.remove.ok', owner, { id: test.id });
          });
          it('Database should be empty', async () => {
            const items = await getManager()
              .createQueryBuilder()
              .select('quotes')
              .from(Quotes, 'quotes')
              .getMany();
            assert.isEmpty(items);
          });
        } else {
          it('Should sent not-found message', async () => {
            await message.isSent('systems.quotes.remove.not-found', owner, { id: test.id });
          });
          it('Database should not be empty', async () => {
            const items = await getManager()
              .createQueryBuilder()
              .select('quotes')
              .from(Quotes, 'quotes')
              .getMany();
            assert.isNotEmpty(items);
          });
        }
      }
    });
  }
});
