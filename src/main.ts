import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

import './settings.js';   
import './triggers.js';   
import './dashboard.js';  

export default Devvit;
