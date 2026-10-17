'use strict';
/**
 * Radar de Leads Externos: o classificador mora em qf-radar-classifier.js (raiz do site) para que o
 * painel administrativo e os scripts usem exatamente a mesma regra. Este arquivo só reexporta.
 */
module.exports = require('../qf-radar-classifier.js');
