import { getRepository, IsNull } from 'typeorm';

import { LOW } from '../constants';
import { Randomizer as RandomizerEntity, RandomizerInterface, RandomizerItem } from '../database/entity/randomizer';
import { parser } from '../decorators';
import { adminEndpoint } from '../helpers/socket';
import Registry from './_interface';
import { addToViewersCache, getFromViewersCache } from '../helpers/permissions';
import permissions from '../permissions';

class Randomizer extends Registry {
  constructor() {
    super();
    this.addMenu({ category: 'registry', name: 'randomizer', id: 'registry/randomizer/list' });
    this.addWidget('randomizer', 'widget-title-randomizer', 'fas fa-dice');
  }

  sockets () {
    adminEndpoint(this.nsp, 'randomizer::getAll', async (cb) => {
      cb(
        await getRepository(RandomizerEntity).find({
          relations: ['items'],
        })
      );
    });
    adminEndpoint(this.nsp, 'randomizer::remove', async (item: Required<RandomizerInterface>, cb) => {
      const result = await getRepository(RandomizerEntity).remove(item);
      await getRepository(RandomizerItem).delete({ randomizerId: IsNull() });
      try {
        cb(
          null,
          result,
        );
      } catch (e) {
        cb (e, null);
      }
    });
    adminEndpoint(this.nsp, 'randomizer::save', async (item: RandomizerInterface & RandomizerInterface[], cb) => {
      const result = await getRepository(RandomizerEntity).save(item);
      await getRepository(RandomizerItem).delete({ randomizerId: IsNull() });
      try {
        cb(
          null,
          result,
        );
      } catch (e) {
        cb (e, null);
      }
    });
    adminEndpoint(this.nsp, 'randomizer::startSpin', async () => {
      this.socket.emit('spin');
    });
    adminEndpoint(this.nsp, 'randomizer::showById', async (id: string, cb) => {
      try {
        await getRepository(RandomizerEntity).update({}, { isShown: false });
        await getRepository(RandomizerEntity).update({ id }, { isShown: true });
        cb(null);
      } catch (e) {
        cb (e);
      }
    });
    adminEndpoint(this.nsp, 'randomizer::hideAll', async (cb) => {
      try {
        await getRepository(RandomizerEntity).update({}, { isShown: false });
        cb(null);
      } catch (e) {
        cb (e);
      }
    });
    adminEndpoint(this.nsp, 'randomizer::getOne', async (id: string, cb) => {
      try {
        cb(
          null,
          await getRepository(RandomizerEntity).findOne({ where: { id }, relations: ['items'] })
        );
      } catch (e) {
        cb (e, null);
      }
    });
    adminEndpoint(this.nsp, 'randomizer::getVisible', async (cb) => {
      try {
        cb(
          null,
          await getRepository(RandomizerEntity).findOne({ where: { isShown: true }, relations: ['items'] })
        );
      } catch (e) {
        cb (e, null);
      }
    });
  }


  /**
   * Check if command is in randomizer (priority: low, fireAndForget)
   *
   * !<command> - hide/show randomizer
   *
   * !<command> go - spin up randomizer
   */
  @parser({ priority: LOW, fireAndForget: true })
  async run (opts: ParserOptions) {
    if (!opts.message.startsWith('!')) {
      return true;
    } // do nothing if it is not a command

    const [command, subcommand] = opts.message.split(' ');

    const randomizer = await getRepository(RandomizerEntity).findOne({ command });
    if (!randomizer) {
      return true;
    }

    if (typeof getFromViewersCache(opts.sender.userId, randomizer.permissionId) === 'undefined') {
      addToViewersCache(
        opts.sender.userId,
        randomizer.permissionId,
        (await permissions.check(opts.sender.userId, randomizer.permissionId, false)).access,
      );
    };

    // user doesn't have permision to use command
    if (!getFromViewersCache(opts.sender.userId, randomizer.permissionId)) {
      return true;
    }

    if (!subcommand) {
      await getRepository(RandomizerEntity).update({}, { isShown: false });
      await getRepository(RandomizerEntity).update({ id: randomizer.id }, { isShown: !randomizer.isShown });
    } else if (subcommand === 'go') {
      this.socket.emit('spin');
    }

    return true;
  }
}

export default new Randomizer();
