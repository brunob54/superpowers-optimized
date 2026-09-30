'use strict';
// A small fake document for the app script of skills/dashboard/template.html:
// it supports the calls that the script makes, records every element that the
// script creates, and throws on any use of innerHTML.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const h = require('./helpers');

const TEMPLATE = fs.readFileSync(path.join(h.REPO, 'skills', 'dashboard', 'template.html'), 'utf8');
const APP = (TEMPLATE.match(/<script id="dashboard-app">([\s\S]*?)<\/script>/) || [])[1] || '';
const STATIC_IDS = ['page-title', 'as-of', 'private-banner', 'viewer-warning', 'load-error', 'tab-waits', 'tab-history', 'panel-waits', 'panel-history'];
// The static elements that the template marks "hidden".
const HIDDEN_IDS = ['private-banner', 'viewer-warning', 'load-error', 'panel-history'];

class FakeNode {
  constructor(doc, tag) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.ownText = '';
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(value) { throw new Error('innerHTML is not allowed'); }
  get innerHTML() { throw new Error('innerHTML is not allowed'); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.doc.ids.set(String(value), this);
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  get firstChild() { return this.children[0] || null; }
}

// A fake document with the static elements of the template, the page's meta
// tag, and an inline state block when <inline> is given.
function fakeDocument(audience, inline) {
  const doc = { ids: new Map(), created: [] };
  const meta = new FakeNode(doc, 'meta');
  meta.setAttribute('content', audience);
  doc.createElement = (tag) => {
    const node = new FakeNode(doc, tag);
    doc.created.push(node);
    return node;
  };
  doc.getElementById = (id) => doc.ids.get(id) || null;
  doc.querySelector = (selector) => (selector === 'meta[name="dashboard-audience"]' ? meta : null);
  STATIC_IDS.forEach((id) => {
    const node = new FakeNode(doc, 'div');
    node.setAttribute('id', id);
    node.hidden = HIDDEN_IDS.includes(id);
  });
  if (inline !== undefined) {
    const block = new FakeNode(doc, 'script');
    block.setAttribute('id', 'dashboard-state');
    block.textContent = inline;
  }
  return doc;
}

// Runs the app script against <doc>; returns the script's global object.
function load(doc, extra) {
  const context = vm.createContext(Object.assign({ document: doc, console, DASHBOARD_NO_BOOT: true }, extra || {}));
  vm.runInContext(APP, context);
  return context;
}

// Lets the promises of the app script settle.
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

module.exports = { TEMPLATE, APP, FakeNode, fakeDocument, load, settle };
