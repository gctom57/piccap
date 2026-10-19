// appinfo.json is what gets installed on the TV, so it is the version to show
import appInfo from '../appinfo.json';
import logIt from './log';

function setButtonActive(btnId, active) {
  const btn = document.getElementById(btnId);
  if (active) {
    btn.classList.add('is-active');
  } else {
    btn.classList.remove('is-active');
  }
}

const views = {
  service: 'btnNavService',
  settings: 'btnNavSettings',
  logs: 'btnNavLogs',
  about: 'btnNavAbout',
};

/* eslint-disable func-names */
window.switchView = function (view) {
  const known = Object.prototype.hasOwnProperty.call(views, view);
  Object.keys(views).forEach((name) => {
    let display = null;
    if (known) {
      display = name === view ? 'block' : 'none';
    }
    document.getElementById(name).style.display = display;
    setButtonActive(views[name], known && name === view);
  });

  if (view === 'settings') {
    // Open non advanced page
    setButtonActive('btnSettingsAdvanced', false);
    document.getElementById('settingItemsNormal').style.display = 'block';
    document.getElementById('settingItemsAdv').style.display = 'none';
  }
};

window.resolutionChanged = function (elem) {
  document.getElementById('manualres').style.display = elem.value === 'manual' ? 'flex' : 'none';
};

window.socketCheckChanged = function (elem) {
  if (elem.checked === true) {
    document.getElementById('settingaddressport').style.display = 'none';
    document.getElementById('settingsocket').style.display = 'flex';
  } else {
    document.getElementById('settingaddressport').style.display = 'flex';
    document.getElementById('settingsocket').style.display = 'none';
  }
};

window.socketSelectChanged = function (elem) {
  document.getElementById('manualsocket').style.display = elem.value === 'manual' ? 'flex' : 'none';
};

window.toggleAdvanced = function () {
  const settingItemsAdv = document.getElementById('settingItemsAdv');
  const settingItemsNormal = document.getElementById('settingItemsNormal');
  const showAdvanced = settingItemsNormal.style.display === 'block';
  setButtonActive('btnSettingsAdvanced', showAdvanced);
  settingItemsNormal.style.display = showAdvanced ? 'none' : 'block';
  settingItemsAdv.style.display = showAdvanced ? 'block' : 'none';
};

window.switchLog = function (location) {
  const showHyperion = location === 'hyperion';
  document.getElementById('consoleLog').style.display = showHyperion ? 'none' : 'block';
  document.getElementById('hyperionLog').style.display = showHyperion ? 'block' : 'none';
  setButtonActive('btnLogSwitchHyperion', showHyperion);
  setButtonActive('btnLogSwitchPicCap', !showHyperion);
};

/* eslint-enable func-names */
function saveLightMode(color) {
  logIt(`Saving ${color} as light mode.`);
  localStorage.setItem('lightMode', color);
}

const lightModes = {
  blue: 'btnLightBlue',
  dark: 'btnLightDark',
  black: 'btnLightBlack',
};

/* eslint-disable func-names */
window.switchLightMode = function (color) {
  if (!Object.prototype.hasOwnProperty.call(lightModes, color)) {
    logIt(`${color} not found. Using blue as default.`);
    window.switchLightMode('blue');
    return;
  }

  Object.keys(lightModes).forEach((mode) => {
    setButtonActive(lightModes[mode], mode === color);
  });
  document.body.className = `theme-${color}`;
  saveLightMode(color);
};

function loadLightMode() {
  const lightMode = localStorage.getItem('lightMode');
  window.switchLightMode(lightMode);
}

function getJSON(url, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'json';

  xhr.timeout = 10000;
  xhr.onload = function () {
    const { status } = xhr;

    if (status === 200 && Array.isArray(xhr.response)) {
      callback(null, xhr.response);
    } else {
      callback(status);
    }
  };
  // Offline TVs and GitHub rate limits are expected; the About page just stays empty
  xhr.onerror = function () {
    callback('network error');
  };
  xhr.ontimeout = function () {
    callback('timeout');
  };

  xhr.send();
}
/* eslint-enable func-names */

function getContributors(owner, repo) {
  getJSON(`https://api.github.com/repos/${owner}/${repo}/contributors`, (err, data) => {
    if (err != null) {
      console.error(err);
    } else {
      const resp = data;
      let div = document.querySelector('.hyperionwebosContributors');
      if (repo === 'piccap') {
        div = document.querySelector('.piccapContributors');
      }
      const users = resp.map((u) => u.login);
      const avatars = resp.map((a) => a.avatar_url);
      let count = 0;
      let pos = 0;
      let last = document.createElement('ul');
      users.forEach((user) => {
        const lielem = document.createElement('li');
        lielem.setAttribute('id', `li${user}`);
        const pelem = document.createElement('p');

        const imgelem = document.createElement('img');
        imgelem.setAttribute('src', avatars[pos]);
        pos += 1;

        pelem.appendChild(imgelem);
        pelem.appendChild(document.createTextNode(user));

        lielem.appendChild(pelem);

        if (count >= 3) {
          const brelem = document.createElement('br');
          div.appendChild(brelem);
          last = document.createElement('ul');
          div.appendChild(last);
          count = 0;
        }
        count += 1;

        last.appendChild(lielem);
        div.appendChild(last);
      });
    }
  });
}
getContributors('webosbrew', 'hyperion-webos');
getContributors('tbsniller', 'piccap');

window.addEventListener('load', () => {
  /* eslint-disable no-undef */
  switchView('service');
  switchLog('piccap');
  loadLightMode();
  /* eslint-enable no-undef */

  const piccapVersion = appInfo.version;
  document.getElementById('txtPicCapVersion').innerHTML = `v${piccapVersion}`;

  // Time of the last event in the status bar, whoever sets the message
  const state = document.getElementById('txtInfoState');
  const time = document.getElementById('txtInfoTime');
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  const stamp = () => {
    const d = new Date();
    time.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  if (window.MutationObserver) {
    new MutationObserver(stamp).observe(state, {
      childList: true, characterData: true, subtree: true,
    });
  }
  stamp();
});
