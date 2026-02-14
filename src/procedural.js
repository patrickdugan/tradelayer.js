const db = require('./db');

const PROCEDURAL_STATES = {
  TEMPLATE: 'TEMPLATE',
  FUNDED: 'FUNDED',
  OPEN: 'OPEN',
  SETTLED: 'SETTLED',
  CLOSED: 'CLOSED',
  DISPUTED: 'DISPUTED'
};

class ProceduralRegistry {
  static async _base() {
    return db.getDatabase('procedural');
  }

  static async upsertTemplate(templateId, data = {}) {
    const base = await this._base();
    const key = `template-${templateId}`;
    const doc = { _id: key, type: 'template', templateId, ...data };
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async upsertContract(contractId, templateId, state = PROCEDURAL_STATES.OPEN, data = {}) {
    const base = await this._base();
    const key = `contract-${contractId}`;
    const doc = { _id: key, type: 'contract', contractId, templateId, state, ...data };
    await base.updateAsync({ _id: key }, { $set: doc }, { upsert: true });
    return doc;
  }

  static async getContract(contractId) {
    const base = await this._base();
    return base.findOneAsync({ _id: `contract-${contractId}` });
  }

  static async ensureIssuanceContext(templateId, contractId, settlementState = '') {
    if (!templateId || !contractId) {
      return { valid: false, reason: 'Missing dlcTemplateId/dlcContractId for procedural token' };
    }
    const contract = await this.getContract(contractId);
    if (!contract) return { valid: false, reason: 'Unknown DLC contract id for procedural token' };
    if (String(contract.templateId) !== String(templateId)) {
      return { valid: false, reason: 'DLC template/contract mismatch' };
    }
    const currentState = String(contract.state || '').toUpperCase();
    if (!['FUNDED', 'OPEN'].includes(currentState)) {
      return { valid: false, reason: `DLC contract state ${currentState} not mintable` };
    }
    if (settlementState && String(settlementState).toUpperCase() !== currentState) {
      return { valid: false, reason: 'Provided settlementState does not match DLC contract state' };
    }
    return { valid: true, contract };
  }

  static async ensureRedemptionContext(templateId, contractId, settlementState = '') {
    if (!templateId || !contractId) {
      return { valid: false, reason: 'Missing dlcTemplateId/dlcContractId for procedural redemption' };
    }
    const contract = await this.getContract(contractId);
    if (!contract) return { valid: false, reason: 'Unknown DLC contract id for procedural redemption' };
    if (String(contract.templateId) !== String(templateId)) {
      return { valid: false, reason: 'DLC template/contract mismatch' };
    }
    const currentState = String(contract.state || '').toUpperCase();
    if (!['SETTLED', 'CLOSED'].includes(currentState)) {
      return { valid: false, reason: `DLC contract state ${currentState} not redeemable` };
    }
    if (settlementState && String(settlementState).toUpperCase() !== currentState) {
      return { valid: false, reason: 'Provided settlementState does not match DLC contract state' };
    }
    return { valid: true, contract };
  }

  static async transitionContract(contractId, nextState, metadata = {}) {
    const base = await this._base();
    const key = `contract-${contractId}`;
    const prev = await base.findOneAsync({ _id: key });
    const merged = {
      ...(prev || { _id: key, type: 'contract', contractId }),
      ...metadata,
      state: String(nextState || '').toUpperCase()
    };
    await base.updateAsync({ _id: key }, { $set: merged }, { upsert: true });
    return merged;
  }
}

module.exports = { ProceduralRegistry, PROCEDURAL_STATES };

