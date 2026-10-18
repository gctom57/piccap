// Loads the built PicCap frontend in jsdom with a mocked webOS service bus.
// Usage: npm test (after building the frontend), or node test/ui.test.js <buildDir>
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const buildDir = process.argv[2] || path.join(__dirname, '..', 'build', 'piccap-frontend');
let fails = 0;
function check(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) fails += 1;
}

function load({
  elevated, settings, statusOk = () => true, responses = {},
}) {
  const calls = [];
  const intervals = [];
  let now = 1000000;
  const html = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8')
    .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  w.Date.now = () => now;
  w.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  w.clearInterval = (id) => { intervals[id - 1] = null; };
  w.XMLHttpRequest = function () { this.open = () => {}; this.send = () => {}; };
  w.console.log = () => {};
  w.webOS = {
    service: {
      request(uri, opts) {
        calls.push({ uri, method: opts.method, parameters: opts.parameters });
        let res = { returnValue: true };
        if (opts.method === 'status') {
          res = statusOk() ? { returnValue: true, elevated: elevated(), isRunning: true, connected: true }
            : { returnValue: false, errorCode: -1, errorText: 'Denied method call' };
          if (!statusOk()) return; // crashed service: no callback at all
        }
        if (opts.method === 'getSettings') res = { returnValue: true, ...settings };
        if (opts.method === 'exec') res = { returnValue: true, stdoutString: '', stderrString: '' };
        if (responses[opts.method]) res = responses[opts.method](opts.parameters);
        opts.onSuccess(res);
      },
    },
  };
  ['polyfills', 'ui', 'servicecalls', 'spatialnavigation'].forEach((b) => {
    w.eval(fs.readFileSync(path.join(buildDir, `${b}.bundled.js`), 'utf8'));
  });
  w.dispatchEvent(new w.Event('load'));
  const tick = (ms = 3000) => { now += ms; intervals.forEach((fn) => fn && fn()); };
  return { w, calls, tick };
}

const baseSettings = {
  backend: 'auto', uibackend: 'auto', novideo: false, nogui: false,
  'unix-socket': false, address: '192.168.1.20', port: 19400, priority: 150,
  fps: 30, width: 240, height: 240, quirks: 0, vsync: true, autostart: true,
  nohdr: false, nopowerstate: false, nv12: false,
};

// 1. Save gating and resolution matching
{
  const { w, calls, tick } = load({ elevated: () => true, settings: baseSettings });
  const doc = w.document;
  check(doc.getElementById('btnSettingsSave').disabled, 'Save disabled before settings load');
  w.serviceSaveSettings();
  w.serviceResetSettings();
  check(!calls.some((c) => c.method === 'setSettings'), 'Save/Reset before load send nothing');

  tick(); // root check -> elevated
  tick(); // settings loop -> getSettings
  check(calls.some((c) => c.method === 'getSettings'), 'settings loaded after root');
  check(!doc.getElementById('btnSettingsSave').disabled, 'Save enabled after load');
  check(doc.getElementById('selectSettingsResolution').value === 'manual', '240x240 shown as manual, not a preset');

  w.serviceSaveSettings();
  const saved = calls.filter((c) => c.method === 'setSettings').pop();
  check(saved && saved.parameters.width === 240 && saved.parameters.height === 240, 'round-trip keeps 240x240');
  check(saved && saved.parameters.autostart === true && saved.parameters.address === '192.168.1.20', 'round-trip keeps address/autostart');

  doc.getElementById('selectSettingsResolution').value = '128x72';
  w.serviceSaveSettings();
  const preset = calls.filter((c) => c.method === 'setSettings').pop();
  check(preset.parameters.width === 128 && preset.parameters.height === 72, '128x72 preset saved');

  // 2. Validation
  const before = calls.filter((c) => c.method === 'setSettings').length;
  doc.getElementById('txtInputSettingsPort').value = '70000';
  w.serviceSaveSettings();
  doc.getElementById('txtInputSettingsPort').value = '19400';
  doc.getElementById('txtInputSettingsAddress').value = '1.2.3.4; reboot';
  w.serviceSaveSettings();
  doc.getElementById('txtInputSettingsAddress').value = '192.168.1.20';
  doc.getElementById('txtInputSettingsFPS').value = '-5';
  w.serviceSaveSettings();
  check(calls.filter((c) => c.method === 'setSettings').length === before, 'invalid port/address/fps not sent');
  check(/Invalid settings/.test(doc.getElementById('txtInfoState').textContent), 'user sees validation error');

  // 3. Log cap
  for (let i = 0; i < 2000; i += 1) w.serviceReload();
  const len = doc.getElementById('textareaConsoleLog').value.length;
  check(len <= 50000 && len > 45000, `console log capped (${len} chars)`);
  check(/Loading settings done!\n$/.test(doc.getElementById('textareaConsoleLog').value), 'newest log line kept');

  // 4. Restart uses SIGTERM first
  w.restartHyperion();
  const kill = calls.filter((c) => c.method === 'exec').pop();
  check(/kill \$pid;/.test(kill.parameters.command) && !/^kill -9/.test(kill.parameters.command), 'restart sends SIGTERM before -9');

  // 5. Socket / resolution toggles still find their elements
  const sock = doc.getElementById('checkSettingsLocalSocket');
  sock.checked = true;
  w.socketCheckChanged(sock);
  check(doc.getElementById('settingsocket').style.display === 'flex' && doc.getElementById('settingaddressport').style.display === 'none', 'socket toggle switches groups');
  check(doc.querySelectorAll('ul > div').length === 0, 'no <div> directly inside <ul>');
}

// 6. Rooting retries and gives up
{
  const { w, calls, tick } = load({ elevated: () => false, settings: baseSettings });
  const elevations = () => calls.filter((c) => c.method === 'exec' && /elevate-service/.test(c.parameters.command)).length;
  tick();
  check(elevations() === 1, 'first elevation attempt');
  for (let i = 0; i < 5; i += 1) tick(3000);
  check(elevations() === 1, 'no duplicate attempt while one is pending');
  for (let i = 0; i < 60; i += 1) tick(3000);
  check(elevations() === 3, `retries capped at 3 (got ${elevations()})`);
  check(/giving up/.test(w.document.getElementById('textareaConsoleLog').value), 'gives up with a message');
}

// 7. Unelevated service that doesn't answer status at all (fresh install)
{
  let elevatedNow = false;
  const { w, calls, tick } = load({ elevated: () => elevatedNow, statusOk: () => elevatedNow, settings: baseSettings });
  const elevations = () => calls.filter((c) => c.method === 'exec' && /elevate-service/.test(c.parameters.command)).length;
  tick();
  check(elevations() === 0, 'first unanswered status gets a grace round');
  tick();
  check(elevations() === 1, 'unanswered status still triggers elevation');
  elevatedNow = true;
  tick();
  check(/returned rooted/.test(w.document.getElementById('textareaConsoleLog').value), 'root detected once service answers');
  tick();
  check(calls.some((c) => c.method === 'getSettings'), 'settings load after elevation');
}

// 8b. Status fails with an error reply
{
  let elevatedNow = false;
  const { w, calls, tick } = load({ elevated: () => elevatedNow, settings: baseSettings, statusOk: () => true });
  const orig = w.webOS.service.request;
  w.webOS.service.request = (uri, opts) => { if (opts.method === 'status' && !elevatedNow) { calls.push({ uri, method: 'status' }); opts.onFailure({ returnValue: false, errorCode: -1 }); return; } orig(uri, opts); };
  tick(); tick();
  check(calls.filter((c) => c.method === 'exec' && /elevate-service/.test(c.parameters.command)).length === 1, 'error reply also leads to elevation');
  elevatedNow = true; tick(); tick();
  check(calls.some((c) => c.method === 'getSettings'), 'settings load after elevation (error case)');
}

// 8. Status never answers: gives up and says so in the status field
{
  const { w, calls, tick } = load({ elevated: () => false, statusOk: () => false, settings: baseSettings });
  for (let i = 0; i < 80; i += 1) tick(3000);
  const elevations = calls.filter((c) => c.method === 'exec' && /elevate-service/.test(c.parameters.command)).length;
  check(elevations === 3, `failed status retries capped at 3 (got ${elevations})`);
  check(w.document.getElementById('txtServiceStatus').textContent === 'Not running as root', 'status field updated on give-up');
}

// 9. Export the in-app log to a file through HBChannel
{
  const { w, calls } = load({ elevated: () => true, settings: baseSettings });
  const ta = w.document.getElementById('textareaConsoleLog');
  ta.value = `héllo ünïcode ✓ 'quotes' $(reboot) \`x\`
${'x'.repeat(30000)}
end`;
  const expected = ta.value;
  w.exportPicCapLog();
  const ex = calls.filter((c) => c.method === 'exec' && /^echo .* \/tmp\/piccap-frontend\.log$/.test(c.parameters.command));
  check(ex.length === 4, `export split into chunks (got ${ex.length})`);
  check(ex.every((c) => /^echo [A-Za-z0-9+/=]+ \| base64 -d >>? \/tmp\/piccap-frontend\.log$/.test(c.parameters.command)), 'export commands contain only base64');
  check(/ > /.test(ex[0].parameters.command) && ex.slice(1).every((c) => / >> /.test(c.parameters.command)), 'first chunk truncates, rest append');
  const decoded = Buffer.concat(ex.map((c) => Buffer.from(c.parameters.command.split(' ')[1], 'base64'))).toString('utf8');
  check(decoded === expected, 'exported file matches the in-app log exactly');
  const bundle = calls.filter((c) => c.method === 'exec' && /piccap-logs\.txt/.test(c.parameters.command));
  check(bundle.length === 1 && /cat \/tmp\/piccap-frontend\.log/.test(bundle[0].parameters.command)
    && /grep hyperion-webos \/var\/log\/messages \| tail -n 500/.test(bundle[0].parameters.command), 'app and service log bundled after the app log');
  check(calls.indexOf(bundle[0]) > calls.indexOf(ex[ex.length - 1]), 'bundle written after the last app log chunk');
  check(/Logs saved to \/tmp\/piccap-logs\.txt/.test(w.document.getElementById('txtInfoState').textContent), 'user told where the logs are');
}

// 10. First-start wizard: no receiver configured yet
{
  const { w, calls, tick } = load({
    elevated: () => true,
    settings: { ...baseSettings, address: '' },
    responses: {
      testReceiver: (p) => (p.address === '192.168.1.19' ? { returnValue: true, reachable: true, flavor: 'HyperHDR' } : { returnValue: true, reachable: false, errorText: 'Connection refused' }),
    },
  });
  const doc = w.document;
  tick(); tick();
  check(doc.getElementById('setupWizard').classList.contains('is-open'), 'wizard opens when no receiver is configured');
  check(doc.activeElement === doc.getElementById('btnWizardTest'), 'remote focus starts in the wizard');
  w.wizardFinish();
  check(!calls.some((c) => c.method === 'setSettings') && /IPv4/.test(doc.getElementById('wizardTestResult').textContent), 'Save and start refuses an empty address');

  doc.getElementById('wizardAddress').value = '192.168.1.30';
  w.testReceiver('wizardAddress', 'wizardPort', 'wizardTestResult');
  check(/Not reachable: Connection refused/.test(doc.getElementById('wizardTestResult').textContent), 'refused connection explained');
  const before = calls.filter((c) => c.method === 'testReceiver').length;
  doc.getElementById('wizardAddress').value = 'not an ip';
  w.testReceiver('wizardAddress', 'wizardPort', 'wizardTestResult');
  check(calls.filter((c) => c.method === 'testReceiver').length === before && /IPv4/.test(doc.getElementById('wizardTestResult').textContent), 'invalid address rejected without asking the service');

  doc.getElementById('wizardAddress').value = '192.168.1.19';
  w.testReceiver('wizardAddress', 'wizardPort', 'wizardTestResult');
  const tested = calls.filter((c) => c.method === 'testReceiver').pop();
  check(tested.parameters.address === '192.168.1.19' && tested.parameters.port === 19400, 'test uses the entered address and default port');
  check(/Reachable \(HyperHDR\)/.test(doc.getElementById('wizardTestResult').textContent), 'reachable receiver shown with its flavor');
  w.wizardFinish();
  const saved = calls.filter((c) => c.method === 'setSettings').pop();
  check(saved && saved.parameters.address === '192.168.1.19' && saved.parameters.port === 19400 && saved.parameters['unix-socket'] === false, 'Save and start saves the entered receiver');
  const order = calls.map((c) => c.method);
  check(order.lastIndexOf('start') > order.lastIndexOf('setSettings'), 'capture starts after the settings were saved');
  check(!doc.getElementById('setupWizard').classList.contains('is-open'), 'wizard closes after saving');
}

// 11. No wizard once a receiver is configured; Settings has a connection test
{
  const { w, calls, tick } = load({
    elevated: () => true,
    settings: baseSettings,
    responses: { testReceiver: () => ({ returnValue: true, reachable: false, errorText: 'No answer (firewall or wrong address?)' }) },
  });
  tick(); tick();
  check(!w.document.getElementById('setupWizard').classList.contains('is-open'), 'no wizard when a receiver is configured');
  check(!w.document.getElementById('btnFindReceivers') && !calls.some((c) => c.method === 'discover'), 'no network search anywhere');
  w.testReceiver('txtInputSettingsAddress', 'txtInputSettingsPort', 'receiverTestResult');
  check(/Not reachable: No answer/.test(w.document.getElementById('receiverTestResult').textContent), 'Settings connection test reports the failure');
}

// 12. Preview is only fetched while the Status page is shown
{
  const { w, calls, tick } = load({
    elevated: () => true,
    settings: baseSettings,
    responses: { getPreview: () => ({ returnValue: true, available: false }) },
  });
  tick(); tick();
  const count = () => calls.filter((c) => c.method === 'getPreview').length;
  check(count() > 0, 'preview requested on the Status page');
  check(w.document.getElementById('previewBox').classList.contains('is-empty'), 'preview hidden while none is available');
  w.switchView('settings');
  const n = count();
  tick(1000); tick(1000);
  check(count() === n, 'no preview requests on other pages');
}

// 13. Health data from newer services; older services don't send it
{
  const health = {
    uptime: 7380,
    connects: 2,
    sendErrors: 1,
    frames: 4500,
    vsyncMissed: 3000,
    videoRestarts: 0,
    timing: {
      waitUs: 21000, acquireUs: 1200, convertUs: 3400, processUs: 500, sendUs: 74000,
    },
  };
  const status = () => ({
    returnValue: true, elevated: true, isRunning: true, connected: true, framerate: 10, health,
  });
  const { w, tick } = load({ elevated: () => true, settings: baseSettings, responses: { status } });
  tick();
  const text = (id) => w.document.getElementById(id).textContent;
  check(!w.document.getElementById('healthCard').hidden, 'health card shown');
  const uptime = text('txtHealthUptime');
  check(uptime === '2 h 3 min', `uptime formatted (got ${uptime})`);
  const counters = text('txtHealthFrames') === '4500' && text('txtHealthMissed') === '3000';
  check(counters, 'frame counters shown');
  const timing = text('txtHealthTiming');
  const expected = 'wait 21.0 · capture 1.2 · convert 3.4 · blend 0.5 · send 74.0 ms';
  check(timing === expected, `timing in ms (got ${timing})`);

  const old = load({ elevated: () => true, settings: baseSettings });
  old.tick();
  const oldHidden = old.w.document.getElementById('healthCard').hidden;
  check(oldHidden, 'health card hidden for services without health data');
}

console.log(fails ? `TESTS_FAILED ${fails}` : 'ALL_PASS');
process.exit(fails ? 1 : 0);
