'use strict';
// Ende-til-ende-tester: `npm run e2e`. Appen serveres av tests/e2e/serve.js, og svarene fra Entur er
// lagret (tests/e2e/fixtures), så testene ikke trenger nett. Kartet tegnes med programvare-WebGL.
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'tests/e2e',
  timeout:60000,
  workers:1,
  reporter:process.env.CI?[['list'],['github']]:'list',
  use:{baseURL:'http://localhost:8130',
    launchOptions:{args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']}},
  webServer:{command:'node tests/e2e/serve.js',url:'http://localhost:8130/',reuseExistingServer:!process.env.CI,env:{PORT:'8130'}}
});
