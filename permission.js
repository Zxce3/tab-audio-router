navigator.mediaDevices.getUserMedia({ audio: true })
  .then((s) => { s.getTracks().forEach((t) => t.stop()); document.getElementById("s").textContent = "Done — you can close this tab."; })
  .catch((e) => (document.getElementById("s").textContent = "Denied: " + e.message));
