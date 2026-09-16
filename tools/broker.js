#!/usr/bin/env node
// Local PeerJS broker for tools/test-coop.js, so co-op can be tested without
// reaching the hosted PeerJS cloud. Binds IPv4 explicitly: some sandboxes have
// no IPv6 and the default dual-stack listen fails with EAFNOSUPPORT.
const { PeerServer } = require('peer');
PeerServer({ port: 9000, path: '/', host: '0.0.0.0' }, () =>
  console.log('peer broker on 0.0.0.0:9000'));
