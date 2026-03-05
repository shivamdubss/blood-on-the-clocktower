import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ROLES } from '../../src/data/roles.js';
import type { RoleId } from '../../src/types/game.js';

// Static imports for all role modules to verify exports
import * as washerwoman from '../../src/roles/washerwoman.js';
import * as librarian from '../../src/roles/librarian.js';
import * as investigator from '../../src/roles/investigator.js';
import * as chef from '../../src/roles/chef.js';
import * as empath from '../../src/roles/empath.js';
import * as fortuneTeller from '../../src/roles/fortuneTeller.js';
import * as undertaker from '../../src/roles/undertaker.js';
import * as monk from '../../src/roles/monk.js';
import * as ravenkeeper from '../../src/roles/ravenkeeper.js';
import * as virgin from '../../src/roles/virgin.js';
import * as slayer from '../../src/roles/slayer.js';
import * as soldier from '../../src/roles/soldier.js';
import * as mayor from '../../src/roles/mayor.js';
import * as butler from '../../src/roles/butler.js';
import * as drunk from '../../src/roles/drunk.js';
import * as recluse from '../../src/roles/recluse.js';
import * as saint from '../../src/roles/saint.js';
import * as poisoner from '../../src/roles/poisoner.js';
import * as spy from '../../src/roles/spy.js';
import * as scarletWoman from '../../src/roles/scarletWoman.js';
import * as baron from '../../src/roles/baron.js';
import * as imp from '../../src/roles/imp.js';

const ROLE_DIR = path.join(process.cwd(), 'src', 'roles');

const ALL_ROLE_IDS: RoleId[] = [
  'washerwoman', 'librarian', 'investigator', 'chef', 'empath',
  'fortuneTeller', 'undertaker', 'monk', 'ravenkeeper', 'virgin',
  'slayer', 'soldier', 'mayor', 'butler', 'drunk', 'recluse',
  'saint', 'poisoner', 'spy', 'scarletWoman', 'baron', 'imp',
];

const roleModules: Record<string, { metadata: unknown; abilityHandler: unknown }> = {
  washerwoman, librarian, investigator, chef, empath, fortuneTeller,
  undertaker, monk, ravenkeeper, virgin, slayer, soldier, mayor,
  butler, drunk, recluse, saint, poisoner, spy, scarletWoman, baron, imp,
};

describe('role module', () => {
  it('each role has its own file in src/roles/', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const filePath = path.join(ROLE_DIR, `${roleId}.ts`);
      expect(fs.existsSync(filePath), `Missing role file: ${roleId}.ts`).toBe(true);
    }
  });

  it('each role file exports metadata with name, team, type and ability handler', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const mod = roleModules[roleId] as any;
      expect(mod.metadata, `${roleId} missing metadata export`).toBeDefined();
      expect(mod.metadata.id).toBe(roleId);
      expect(mod.metadata.name).toBeTruthy();
      expect(mod.metadata.team).toBeTruthy();
      expect(mod.metadata.type).toBeTruthy();
      expect(typeof mod.abilityHandler, `${roleId} missing abilityHandler`).toBe('function');
    }
  });

  it('no role file imports from another role file', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const filePath = path.join(ROLE_DIR, `${roleId}.ts`);
      const source = fs.readFileSync(filePath, 'utf-8');
      const crossImport = /from\s+['"]\.\.\/roles\//;
      expect(crossImport.test(source), `${roleId}.ts has cross-role import`).toBe(false);
      for (const otherRole of ALL_ROLE_IDS) {
        if (otherRole === roleId) continue;
        const siblingImport = new RegExp(`from\\s+['\"]\\.\\/` + otherRole);
        expect(siblingImport.test(source), `${roleId}.ts imports from ${otherRole}`).toBe(false);
      }
    }
  });

  it('role file metadata matches central ROLES data for all roles', () => {
    for (const roleId of ALL_ROLE_IDS) {
      const mod = roleModules[roleId] as any;
      const centralRole = ROLES.find((r) => r.id === roleId);
      expect(centralRole, `${roleId} not found in ROLES`).toBeDefined();
      expect(mod.metadata.team, `${roleId} team mismatch`).toBe(centralRole!.team);
      expect(mod.metadata.type, `${roleId} type mismatch`).toBe(centralRole!.type);
      expect(mod.metadata.ability, `${roleId} ability mismatch`).toBe(centralRole!.ability);
      expect(mod.metadata.firstNight, `${roleId} firstNight mismatch`).toBe(centralRole!.firstNight);
      expect(mod.metadata.otherNights, `${roleId} otherNights mismatch`).toBe(centralRole!.otherNights);
    }
  });
});
