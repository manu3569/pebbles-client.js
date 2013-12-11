"use strict";

var Client = require("../client");
var inherits = require("inherits");
var Readable = require('stream').Readable;
var JSONStream = require('json-stream');
var through = require("through");
var url = require("url");

module.exports = TiramisuClient

function TiramisuClient() {
  Client.apply(this, arguments);
}

inherits(TiramisuClient, Client);

/**
 * Overrides attributes in a dom element returning a hash with overridden attributes and their original values
 * @param elem
 * @param attrs
 * @return {Object}
 */
function overrideAttrs(elem, attrs) {
  var overridden = {};
  for (var attr in attrs) if (attrs.hasOwnProperty(attr)) {
    var newValue = attrs[attr];
    overridden[attr] = elem.getAttribute(attr);
    if (typeof newValue === 'undefined')
      elem.removeAttribute(attr);
    else
      elem.setAttribute(attr, newValue);
  }
  return overridden;
}

TiramisuClient.prototype.upload = function (endpoint, fileField, cb) {
  var iframeName = 'pebbles_iframe_uploader' + Math.random().toString(36).substring(2);
  var iframe = document.createElement("iframe");
  iframe.name = iframeName;
  document.body.appendChild(iframe)
  var form = fileField.form;

  var action = url.parse(this.urlTo(endpoint), true);
  action.query.postmessage = true;

  var overriddenAttrs = overrideAttrs(form, {
    method: 'post',
    target: iframeName,
    action: action.format(),
    enctype: 'multipart/form-data'
  });
  //iframe.style.display = "none";
  form.submit();

  //var doc = iframe.contentWindow.document;

  //console.log(doc);
  window.addEventListener('message', function(e) {
    console.log("Got message", e.data)
  })
};

