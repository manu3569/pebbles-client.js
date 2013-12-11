/**
 *
 * Fallback iframe uploader legacy browsers (like IE 9) not supporting the HTML5 File API (http://www.w3.org/TR/FileAPI/)
 * It mimics the progress notification during upload
 *
 * Tested in:
 *  [X] IE 6 (who cares anyway?)
 *  [x] IE 7
 *  [x] IE 8
 *  [x] IE 9
 *
 *  It **should** also work in other browsers not supporting the file api
 *
 * Known issues:
 *  - No support for XDR
 *  - No support for multiple files
 *  - It posts all form data through an iframe, not only content of file fields
 *  - Expects that the upload URL returns something that resembles an XHR object ({status: xxx, responseText: '(...)'} etc.
 *    Anything apart from JSON is treated as a general 500 error with response body as responseText
 *  - IE8 has some ways of simulating progress event that could be considered supporting
 */

var Repeat = require("repeat/jquery");
var $ = require("jquery");
var poll = require("poll");


/**
 * Overrides attributes in a jQuery element returning overridden attributes and their original values
 * @param $elem
 * @param attrs
 * @return {Object}
 */
var overrideAttrs = function ($elem, attrs) {
  var old = {};
  for (var attr in attrs) if (attrs.hasOwnProperty(attr)) {
    var newValue = attrs[attr];
    if (attr === 'enctype' && !newValue) {
      // jQuery bug #6743 todo: verify this is still an issue
      newValue = 'application/x-www-form-urlencoded';
    }
    old[attr] = $elem.attr(attr);
    $elem.attr(attr, newValue || '');
  }
  return old;
};

/**
 * Left trims a string for a given character
 * @param str string to strip
 * @param chr
 * @return String
 */
var ltrim = function (str, chr) {
  var i = -1;
  if (!chr) chr = ' ';
  while (str.charAt(++i) === chr);
  return str.substring(i, str.length);
};

var getFrameDoc = function(iframe) {
  var doc = iframe.contentWindow || iframe.contentDocument;
  return doc && (doc.document || doc);
};

/**
 * Reads the content of the body in an iframe
 * @param {HTMLIFrameElement} iframe
 * @return {String}
 */
var getFrameBody = function (iframe) {
  // Ltrim off the stupid IE prelude garbage sendt from server
  return ltrim(getFrameDoc(iframe).body.innerText);
};

/**
 * Callback for preventing submission of form
 * @param e event
 * @return {Boolean} false always
 */
var cancelEvent = function (e) {
  e.preventDefault();
  return false;
};

var parseUrl = (function() {
  var a = document.createElement('a');
  return function(url) {
    a.href = url;
    url = a.href;
    a.href = url;
    return {
      href: url,
      protocol: a.protocol,
      host: a.host,
      hostname: a.hostname,
      port: a.port,
      search: a.search,
      hash: a.hash,
      pathname: a.pathname
    };
  };
}());

function IframeUploader(form) {
  this.$form = $(form);
  this.iframeName = 'uploader_iframe_' + Math.random().toString(36).substring(2);
  this.$iframe = $('<iframe id="' + this.iframeName + '" name="' + this.iframeName + '" src="javascript:\'\'" style="display:none"></iframe>').appendTo(form);
  this.uploading = false;
}

IframeUploader.prototype.upload = function(fileField, url) {
  if (this.uploading) return;

  this.$iframe.css("display", "none");
  var deferred = $.Deferred();
  var responseReceived = false;

  // The following line is causing hard-to-track bugs in IE9 because Sizzle is caching document between DOM selections
  // this.$iframe.contents().find('body').empty();
  // Using this instead:
  getFrameDoc(this.$iframe[0]).body.innerHTML = "";

  // Override the form's target and action attribute (and save the overridden for later)
  var overriddenAttrs = overrideAttrs(this.$form, {
    method: 'post',
    target: this.iframeName,
    action: url,
    enctype: 'multipart/form-data'
  });

  // --- Setup polling for received content in the iframe body
  var poller = poll(function () {
    try {
      var content = getFrameBody(this.$iframe[0]);
    }
    catch (e) {
      var msg = 'Could not read contents of iframe. ';
      var urlDomain = parseUrl(url).hostname;
      this.$iframe.attr({height: 400, width: 700}).css("display", "block");
      if (urlDomain != document.domain) {
        msg += "\nThis error is likely to be caused by the current document.domain ("+document.domain+") being different "+
          " from the domain of the url you are uploading to ("+urlDomain+")."+
          "\n Be aware of Same Origin Policy restrictions when trying to read content of an iframe from another domain.";
      }
      else {
        msg += 'Please verify that HTTP POST to '+ url +' is a valid request. ' +
          'Also note that Internet Explorer will give access denied when trying to read content of the standard ' +
          'error pages (i.e. if the server responds with a status code != 2xx)';
      }
      msg += '\nOriginal error thrown when trying to read iframe content was: ' + e.message +
        '\nThe uploader iframe is now shown for debugging purposes.';
      deferred.reject({ percent:100, status:"failed", message:msg });
      throw Error(msg);
    }
    var chunks = content.split("\n");
    return chunks.slice(0, chunks.length - 1);
  }.bind(this)).every(200, 'ms');

  if (!JSON) throw Error("Missing JSON! Get it from here: http://bestiejs.github.com/json3/");

  poller.progress(function () {
    responseReceived = true;
  });

  poller.progress(function (chunks) {
    // Chunks of streamed response from server has appeared in the iframe body, lets parse and report progress
    chunks.forEach(function (chunk) {
      var json;
      try {
        json = JSON.parse(chunk);
      }
      catch (e) {
        // if its not json, assume the server raised an unexpected error
        json = { percent:100, status:"failed", message:chunk };
      }
      if (json.status === 'failed') {
        deferred.reject(json);
      }
      else {
        deferred.notify(json);
        if (json.status === 'completed') {
          poller.cancel();
          deferred.resolve(json);
        }
      }
    });
  });

  var fakePercent = 0;
  var fakeReport = Repeat(function () {
    fakePercent += ((100 - fakePercent) / 100);
    deferred.notify({percent:fakePercent, approximate:true, status:'uploading'});
  }).every(200, 'ms').until(function () {
      return responseReceived;
    });

  // --- When upload has completed (failed or succeeded)
  deferred.always(function () {
    this.$form.unbind('submit', cancelEvent);

    // Restore previously overriden attributes
    overrideAttrs(this.$form, overriddenAttrs);
    this.uploading = false;
  }.bind(this));

  // --- Create a fake progress report until we get response from server
  this.$iframe[0].attachEvent("onreadystatechange", function () {
    var readyState = this.$iframe[0].readyState;
    if (readyState == 'complete') {
      poller.next().stop();
      fakeReport.stop();
    }
  }.bind(this));

  // --- Now we are done setting everything up

  // Start reporting fake progress
  fakeReport.start();

  // Start polling the iframe body
  poller.start();

  // Remove the event listener that cancels the submit event, submit the event and add the listener
  // back in again to prevent multiple submissions
  this.$form.unbind('submit', cancelEvent);
  this.$form[0].submit();
  this.$form.bind('submit', cancelEvent);

  return deferred.promise();
};

module.exports = IframeUploader;