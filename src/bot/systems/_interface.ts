import Module from '../_interface';

class System extends Module {
  constructor() {
    super('systems');
    this.addMenu({ category: 'settings', name: 'systems', id: 'settings/systems' });
  }
}

export default System;
