import logIt from './log';

const availableQuirks = {
  // DILE_VT
  QUIRK_DILE_VT_CREATE_EX: 0x1,
  QUIRK_DILE_VT_NO_FREEZE_CAPTURE: 0x2,
  QUIRK_DILE_VT_DUMP_LOCATION_2: 0x4,
  // vtCapture
  QUIRK_VTCAPTURE_FORCE_CAPTURE: 0x100,
};

const resolutionPresets = {
  '320x180': [320, 180],
  '256x144': [256, 144],
  '192x108': [192, 108],
  '128x72': [128, 72],
};

// Same limits the service enforces (hyperion-webos src/settings.c)
const limits = {
  port: [1, 65535],
  priority: [0, 255],
  fps: [0, 240],
  width: [16, 3840],
  height: [16, 2160],
};
const UNIX_PATH_MAX = 108;

// Rooting: how long one elevation attempt may take before retrying, and how
// often to retry before giving up
const ELEVATION_TIMEOUT_MS = 30000;
const MAX_ELEVATION_ATTEMPTS = 3;

let isRoot = false;
let elevationStartedAt = 0; // 0 = no elevation attempt running
let elevationAttempts = 0;
let statusFailures = 0;
let settingsLoaded = false;

function setSettingsButtonsEnabled(enabled) {
  ['btnSettingsSave', 'btnSettingsReset'].forEach((id) => {
    document.getElementById(id).disabled = !enabled;
  });
}

function onHBExec(result) {
  if (result.returnValue === true) {
    logIt(`HBChannel exec returned. stdout: ${result.stdoutString} stderr: ${result.stderrString}`);
  } else {
    logIt(`HBChannel exec failed! Code: ${result.errorCode}`);
  }
}

function killHyperion() {
  document.getElementById('txtInfoState').innerHTML = 'Killing service..';
  logIt('Calling HBChannel exec to stop hyperion-webos');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        // SIGTERM lets the service release the capture drivers; only force
        // kill if it is still alive after 5 seconds
        command: 'pid=$(pidof hyperion-webos) || exit 0; kill $pid; for i in 1 2 3 4 5; do sleep 1; kill -0 $pid 2>/dev/null || exit 0; done; kill -9 $pid',
      },
      onSuccess: onHBExec,
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
}

function makeServiceRoot() {
  logIt('Rooting..');
  document.getElementById('txtInfoState').innerHTML = 'Rooting app and service..';
  logIt('Calling HBChannel exec to elevate app and service');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.piccap; /media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service org.webosbrew.piccap.service',
      },
      onSuccess(result) {
        onHBExec(result);
        if (result.returnValue !== true) {
          // Allow the root check loop to retry elevation
          elevationStartedAt = 0;
          document.getElementById('txtInfoState').textContent = 'Elevation failed! Retrying..';
          return;
        }

        logIt('Elevation completed - killing service process..');
        document.getElementById('txtInfoState').textContent = 'Killing service..';
        killHyperion();
      },
      onFailure(result) {
        onHBExec(result);
        // Allow the root check loop to retry elevation
        elevationStartedAt = 0;
        document.getElementById('txtInfoState').textContent = 'Elevation failed! Retrying..';
      },
    },
  );
  /* eslint-enable no-undef */
}

let checkRootStatusIntervalID = null;
function onCheckRootStatus(result) {
  if (isRoot) {
    return;
  }

  // A service that is not elevated yet may not answer at all (it can be
  // denied on the bus until it is), so a failed call still leads to elevation
  const statusFailed = result.returnValue !== true;
  if (statusFailed) {
    statusFailures += 1;
    logIt(`Getting root-status from PicCap-Service failed! Code: ${result.errorCode}`);
    document.getElementById('txtInfoState').innerHTML = 'PicCap-Service status failed!';
    // Give a freshly launched service one round to come up first
    if (statusFailures < 2) {
      return;
    }
  } else if (result.elevated) {
    logIt('PicCap-Service returned rooted!');
    document.getElementById('txtInfoState').innerHTML = 'Running as root';
    isRoot = true;
    clearInterval(checkRootStatusIntervalID);
    elevationStartedAt = 0;
    return;
  }

  if (elevationStartedAt !== 0 && Date.now() - elevationStartedAt < ELEVATION_TIMEOUT_MS) {
    logIt('PicCap-Service returned not rooted yet! Will check again soon.');
    document.getElementById('txtInfoState').innerHTML = 'Not running as root. Service elevation in progress..';
    return;
  }

  // No attempt running, or the last one never took effect
  if (elevationAttempts >= MAX_ELEVATION_ATTEMPTS) {
    logIt(`Service is still not elevated after ${elevationAttempts} attempts, giving up.`);
    document.getElementById('txtInfoState').textContent = 'Elevation failed! Is Homebrew Channel rooted? Restart PicCap to retry.';
    document.getElementById('txtServiceStatus').textContent = 'Not running as root';
    clearInterval(checkRootStatusIntervalID);
    return;
  }

  elevationAttempts += 1;
  elevationStartedAt = Date.now();
  logIt(`Starting elevation attempt ${elevationAttempts}/${MAX_ELEVATION_ATTEMPTS}.`);
  document.getElementById('txtInfoState').innerHTML = 'Not running as root. Service elevation in progress..';
  makeServiceRoot();
}

function checkRoot() {
  document.getElementById('txtServiceStatus').innerHTML = 'Processing root check';
  logIt('Starting loop for PicCap-Service to get root-status');

  checkRootStatusIntervalID = window.setInterval(() => {
    logIt('Calling PicCap-Service to get root-status');
    document.getElementById('txtInfoState').innerHTML = 'Checking root status';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'status',
        parameters: {},
        onSuccess: onCheckRootStatus,
        onFailure: onCheckRootStatus,
      },
    );
    /* eslint-enable no-undef */
  }, 3000);
}

function getStatus() {
  document.getElementById('txtInfoState').innerHTML = 'Getting status info..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'status',
      parameters: {},
      onSuccess(result) {
        if (result.returnValue === true) {
          document.getElementById('txtServiceVersion').textContent = result.version;
          document.getElementById('txtServiceStatus').textContent = result.isRunning ? 'Capturing' : 'Not capturing';

          document.getElementById('txtInfoReceiver').textContent = result.connected ? 'Connected' : 'Disconnected';
          document.getElementById('txtInfoVideo').textContent = result.videoRunning ? `Capturing with ${result.videoBackend}` : 'Not capturing';
          document.getElementById('txtInfoUI').textContent = result.uiRunning ? `Capturing with ${result.uiBackend}` : 'Not capturing';
          /* Round to 2 decimal points */
          document.getElementById('txtInfoFPS').textContent = typeof result.framerate === 'number' ? result.framerate.toFixed(2) : '-';

          document.getElementById('txtInfoState').innerHTML = 'Status info refreshed';
        } else {
          logIt('Getting status info from PicCap-Service failed! Return value false!');
          document.getElementById('txtInfoState').innerHTML = 'Getting status info failed!';
        }
      },
      onFailure(result) {
        logIt(`Getting status info from PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Getting status info failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

function getSettings() {
  document.getElementById('txtInfoState').innerHTML = 'Loading settings..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'getSettings',
      parameters: {},
      onSuccess(result) {
        if (result.returnValue === true) {
          document.getElementById('selectSettingsVideoBackend').value = result.novideo === true ? 'disabled' : result.backend || 'auto';
          document.getElementById('selectSettingsGraphicalBackend').value = result.nogui === true ? 'disabled' : result.uibackend || 'auto';

          document.getElementById('checkSettingsLocalSocket').checked = result['unix-socket'];
          socketCheckChanged(document.getElementById('checkSettingsLocalSocket'));

          const address = result.address || '';
          if (address.includes('/')) {
            switch (address) {
              case '/tmp/hyperhdr-domain':
                document.getElementById('selectSettingsSocket').value = 'hyperhdr';
                break;
              default:
                document.getElementById('selectSettingsSocket').value = 'manual';
                document.getElementById('txtInputSettingsSocketPath').value = address;
            }
            document.getElementById('txtInputSettingsAddress').value = '127.0.0.1';
          } else {
            document.getElementById('txtInputSettingsAddress').value = address || '127.0.0.1';
          }
          socketSelectChanged(document.getElementById('selectSettingsSocket'));

          document.getElementById('txtInputSettingsPort').value = result.port;
          document.getElementById('txtInputSettingsPriority').value = result.priority;

          document.getElementById('txtInputSettingsFPS').value = result.fps;

          // Match presets on the exact size: different sizes can share an area
          const resolution = `${result.width}x${result.height}`;
          if (Object.prototype.hasOwnProperty.call(resolutionPresets, resolution)) {
            document.getElementById('selectSettingsResolution').value = resolution;
          } else {
            document.getElementById('selectSettingsResolution').value = 'manual';
          }
          document.getElementById('txtInputSettingsWidth').value = result.width;
          document.getElementById('txtInputSettingsHeight').value = result.height;
          resolutionChanged(document.getElementById('selectSettingsResolution'));

          Object.keys(availableQuirks).forEach((quirk) => {
            logIt(`Processing: ${quirk}`);
            const quirkval = availableQuirks[quirk];
            const enabled = (result.quirks & quirkval) === quirkval;
            if (enabled) {
              logIt(`Quirk ${quirk} enabled!`);
            }
            document.getElementById(`checkSettings${quirk}`).checked = enabled;
          });

          document.getElementById('checkSettingsVSync').checked = result.vsync;
          document.getElementById('checkSettingsAutostart').checked = result.autostart;
          document.getElementById('checkSettingsNoHDR').checked = result.nohdr;
          document.getElementById('checkSettingsNoPowerstate').checked = result.nopowerstate;
          document.getElementById('checkSettingsNV12').checked = result.nv12;

          settingsLoaded = true;
          setSettingsButtonsEnabled(true);
          logIt('Loading settings done!');
          document.getElementById('txtInfoState').innerHTML = 'Settings loaded';
        } else {
          logIt('Getting settings from PicCap-Service failed! Return value false!');
          document.getElementById('txtInfoState').innerHTML = 'Getting settings failed!';
        }
      },
      onFailure(result) {
        logIt(`Getting settings from PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Getting settings failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

window.restartHyperion = () => {
  document.getElementById('txtInfoState').innerHTML = 'Killing hyperion.. Will be started again through status loop';
  killHyperion();
};

function saveSettings(config) {
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.piccap.service',
    {
      method: 'setSettings',
      parameters: config,
      onSuccess(result) {
        if (result.returnValue === true) {
          logIt('Saving settings success!');
          document.getElementById('txtInfoState').innerHTML = 'Save settings success!';
        } else {
          logIt(`Save settings for PicCap-Service failed! ${result.errorText || 'Settings were rejected.'}`);
          document.getElementById('txtInfoState').innerHTML = 'Save settings failed!';
        }
        // Show what the service actually has now
        getSettings();
      },
      onFailure(result) {
        logIt(`Save settings for PicCap-Service failed! Code: ${result.errorCode}`);
        document.getElementById('txtInfoState').innerHTML = 'Save settings failed!';
      },
    },
  );
  /* eslint-enable no-undef */
}

function isIPv4(address) {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

// Returns an error message, or null when the service will accept the config
function validateConfig(config) {
  if (config['unix-socket']) {
    if (typeof config.address !== 'string' || config.address[0] !== '/' || config.address.length >= UNIX_PATH_MAX) {
      return `Socket path must be absolute and shorter than ${UNIX_PATH_MAX} characters`;
    }
  } else if (typeof config.address !== 'string' || !isIPv4(config.address)) {
    return 'Address must be an IPv4 address like 192.168.1.10';
  }

  const invalid = Object.keys(limits).find((key) => {
    const [min, max] = limits[key];
    return !Number.isInteger(config[key]) || config[key] < min || config[key] > max;
  });
  if (invalid) {
    return `${invalid} must be a whole number from ${limits[invalid][0]} to ${limits[invalid][1]}`;
  }

  return null;
}

function readInt(id) {
  const value = document.getElementById(id).value.trim();
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

window.serviceResetSettings = () => {
  if (!settingsLoaded) {
    logIt('Settings not loaded yet, not resetting.');
    return;
  }
  document.getElementById('txtInfoState').innerHTML = 'Loading default settings..';
  const config = {
    backend: 'auto',
    uibackend: 'auto',

    novideo: false,
    nogui: false,

    'unix-socket': false,
    address: '',
    port: 19400,
    priority: 150,

    fps: 0,

    width: 320,
    height: 180,
    quirks: 0,

    vsync: true,
    autostart: false,
    nohdr: false,
    nopowerstate: false,
    nv12: false,
  };
  logIt(`Config: ${JSON.stringify(config)}`);

  document.getElementById('txtInfoState').innerHTML = 'Sending default settings..';
  saveSettings(config);
};

window.serviceSaveSettings = () => {
  // Saving an unloaded form would overwrite the stored config with blanks
  if (!settingsLoaded) {
    logIt('Settings not loaded yet, not saving.');
    document.getElementById('txtInfoState').textContent = 'Settings not loaded yet!';
    return;
  }
  document.getElementById('txtInfoState').innerHTML = 'Collecting settings..';

  let quirkcalc = 0;
  Object.keys(availableQuirks).forEach((quirk) => {
    logIt(`Processing quirk: ${quirk}`);
    const quirkval = availableQuirks[quirk];
    logIt(`Quirk val: ${quirkval}`);
    if (document.getElementById(`checkSettings${quirk}`).checked === true) {
      quirkcalc |= quirkval;
      logIt(`Quirkcalc: ${quirkcalc}`);
    }
  });

  let width;
  let height;
  const resolution = document.getElementById('selectSettingsResolution').value;
  if (Object.prototype.hasOwnProperty.call(resolutionPresets, resolution)) {
    [width, height] = resolutionPresets[resolution];
  } else {
    width = readInt('txtInputSettingsWidth');
    height = readInt('txtInputSettingsHeight');
  }

  let address;
  if (document.getElementById('checkSettingsLocalSocket').checked === true) {
    switch (document.getElementById('selectSettingsSocket').value) {
      case 'hyperhdr':
        address = '/tmp/hyperhdr-domain';
        break;
      case 'manual':
        address = document.getElementById('txtInputSettingsSocketPath').value;
        break;
      default:
        address = undefined;
        logIt('Address wasnt found!');
        break;
    }
  } else {
    address = document.getElementById('txtInputSettingsAddress').value;
  }

  const config = {
    backend: document.getElementById('selectSettingsVideoBackend').value === 'disabled' ? 'auto' : document.getElementById('selectSettingsVideoBackend').value,
    uibackend: document.getElementById('selectSettingsGraphicalBackend').value === 'disabled' ? 'auto' : document.getElementById('selectSettingsGraphicalBackend').value,

    novideo: document.getElementById('selectSettingsVideoBackend').value === 'disabled',
    nogui: document.getElementById('selectSettingsGraphicalBackend').value === 'disabled',

    'unix-socket': document.getElementById('checkSettingsLocalSocket').checked,
    address,
    port: readInt('txtInputSettingsPort'),
    priority: readInt('txtInputSettingsPriority'),

    fps: readInt('txtInputSettingsFPS'),

    width,
    height,
    quirks: quirkcalc,

    vsync: document.getElementById('checkSettingsVSync').checked,
    autostart: document.getElementById('checkSettingsAutostart').checked,
    nohdr: document.getElementById('checkSettingsNoHDR').checked,
    nopowerstate: document.getElementById('checkSettingsNoPowerstate').checked,
    nv12: document.getElementById('checkSettingsNV12').checked,
  };

  logIt(`Config: ${JSON.stringify(config)}`);

  const error = validateConfig(config);
  if (error) {
    logIt(`Not saving: ${error}`);
    document.getElementById('txtInfoState').textContent = `Invalid settings: ${error}`;
    return;
  }

  document.getElementById('txtInfoState').innerHTML = 'Sending settings..';
  saveSettings(config);
};

window.reloadHyperionLog = () => {
  logIt('Calling HBCHannel to get latest 200 hyperion-webos log lines.');
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: 'grep hyperion-webos /var/log/messages | tail -n200',
      },
      onSuccess(result) {
        onHBExec(result);
        const textareaHyperionLog = document.getElementById('textareaHyperionLog');
        textareaHyperionLog.value = `${result.stdoutString}\r\n`;
      },
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
};

// Using this function to setup logging for now.
// Future start/stop of currently not implemented hyperion-webos log method.
window.startStopLogging = () => {
  logIt('Setup logging using HBChannel');
  document.getElementById('txtInfoState').innerHTML = 'Calling HBChannel for log setup';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'exec',
      parameters: {
        command: '/media/developer/apps/usr/palm/services/org.webosbrew.piccap.service/setuplegacylogging.sh',
      },
      onSuccess: onHBExec,
      onFailure: onHBExec,
    },
  );
  /* eslint-enable no-undef */
/*
  // Future Stuff
  const btnLogStartStop = document.getElementById('btnLogStartStop');
  if (!loggingStarted) {
    loggingStarted = true;
    btnLogStartStop.innerHTML = 'Stop logging';
  } else {
    loggingStarted = false;
    btnLogStartStop.innerHTML = 'Start logging';
  } */
};

function onServiceCallback(result) {
  if (result.returnValue === true) {
    logIt('Servicecall returned successfully.');
    document.getElementById('txtInfoState').innerHTML = 'Servicecall success!';
  } else {
    logIt(`Servicecall failed! Code: ${result.errorCode}`);
    document.getElementById('txtInfoState').innerHTML = 'Servicecall failed!';
  }
}

window.serviceStart = () => {
  logIt('Start clicked');
  try {
    document.getElementById('txtServiceStatus').innerHTML = 'Starting service...';
    document.getElementById('txtInfoState').innerHTML = 'Sending start command';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'start',
        parameters: {},
        onSuccess: onServiceCallback,
        onFailure: onServiceCallback,
      },
    );
    /* eslint-enable no-undef */
  } catch (err) {
    document.getElementById('txtServiceStatus').innerHTML = `Failed: ${JSON.stringify(err)}`;
  }
};

window.serviceStop = () => {
  logIt('Stop clicked');
  try {
    document.getElementById('txtServiceStatus').innerHTML = 'Stopping service...';
    document.getElementById('txtInfoState').innerHTML = 'Sending stop command';
    /* eslint-disable no-undef */
    webOS.service.request(
      'luna://org.webosbrew.piccap.service',
      {
        method: 'stop',
        parameters: {},
        onSuccess: onServiceCallback,
        onFailure: onServiceCallback,
      },
    );
    /* eslint-enable no-undef */
  } catch (err) {
    document.getElementById('txtServiceStatus').innerHTML = `Failed: ${JSON.stringify(err)}`;
  }
};

window.serviceReload = () => {
  logIt('Reload clicked');
  getSettings();
};

window.tvReboot = () => {
  logIt('Trying to reboot TV using HBChannel..');
  document.getElementById('txtInfoState').innerHTML = 'Rebooting TV..';
  /* eslint-disable no-undef */
  webOS.service.request(
    'luna://org.webosbrew.hbchannel.service',
    {
      method: 'reboot',
      parameters: {},
      onSuccess: onServiceCallback,
      onFailure: onServiceCallback,
    },
  );
  /* eslint-enable no-undef */
};

window.addEventListener('load', () => {
  logIt('Startup of PicCap...');
  setSettingsButtonsEnabled(false);
  checkRoot();

  logIt('Starting load settings loop...');
  const getStatusIntervalID = window.setInterval(() => {
    if (isRoot === true) {
      logIt('Loading settings, we are rooted.');
      getSettings();
      clearInterval(getStatusIntervalID);
    }
  }, 3000);

  logIt('Starting status loop...');
  setInterval(() => {
    // No point polling the service while the app is in the background
    if (!document.hidden) {
      getStatus();
    }
  }, 4000);
});
