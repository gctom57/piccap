// Keep the on-screen log bounded: the app runs for days on a TV and the status
// loop logs every few seconds.
const MAX_LOG_CHARS = 50000;

export default function logIt(message) {
  console.log(message);
  const textareaConsoleLog = document.getElementById('textareaConsoleLog');
  if (!textareaConsoleLog) {
    return;
  }

  let text = `${textareaConsoleLog.value}${message}\n`;
  if (text.length > MAX_LOG_CHARS) {
    // Drop whole lines from the top
    const cut = text.indexOf('\n', text.length - MAX_LOG_CHARS);
    text = text.slice(cut + 1);
  }
  textareaConsoleLog.value = text;
}
