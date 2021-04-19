#!/usr/bin/env node
/* eslint-disable @typescript-eslint/unbound-method */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import YAML from 'yaml';
import fs from 'fs';
import SeederConfig from '../lib/SeederConfig';
import Seeder from '../lib/Seeder';
import { cloneDeep } from 'lodash';

void (async () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const argv = yargs(hideBin(process.argv))
    .command('init <file>', 'run the initial seed gen')
    .command('cont <file>', 'run the continuous seed gen')
    .demandCommand(1, 'Specify at least one command')
    .usage('Usage: $0 <command>')
    .help('help').argv;

  const seedConfigFile = argv.file as string;
  const seedConfig = YAML.parse(
    fs.readFileSync(seedConfigFile, 'utf8')
  ) as SeederConfig;
  const seeder = new Seeder(cloneDeep(seedConfig));
  await seeder.start();
})();
