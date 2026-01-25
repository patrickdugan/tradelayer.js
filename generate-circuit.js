/**
 * rPNL Fraud Proof Circuit Generator
 * 
 * Generates a Bristol-format circuit that verifies:
 *   expectedPNL = (tradePrice - avgEntry) * amount * side
 *   fraud = (expectedPNL != claimedPNL)
 * 
 * Bristol format:
 *   Line 1: <num_gates> <num_wires>
 *   Line 2+: <num_inputs> <num_outputs> <in1> [in2] <out> <gate_type>
 * 
 * Gate types: AND, XOR, INV (NOT), OR
 * Free gates in garbled circuits: XOR, INV (no ciphertext cost)
 * Non-free gates: AND, OR (require garbled table)
 */

class BristolCircuit {
  constructor() {
    this.gates = [];
    this.wireCount = 0;
    this.inputWires = [];
    this.outputWires = [];
  }

  // Allocate n new wires, return array of wire IDs
  allocWires(n) {
    const wires = [];
    for (let i = 0; i < n; i++) {
      wires.push(this.wireCount++);
    }
    return wires;
  }

  // Define input wires
  addInputs(n) {
    const wires = this.allocWires(n);
    this.inputWires.push(...wires);
    return wires;
  }

  // Basic gates
  andGate(a, b) {
    const out = this.wireCount++;
    this.gates.push({ inputs: [a, b], outputs: [out], type: 'AND' });
    return out;
  }

  xorGate(a, b) {
    const out = this.wireCount++;
    this.gates.push({ inputs: [a, b], outputs: [out], type: 'XOR' });
    return out;
  }

  invGate(a) {
    const out = this.wireCount++;
    this.gates.push({ inputs: [a], outputs: [out], type: 'INV' });
    return out;
  }

  orGate(a, b) {
    // OR(a,b) = XOR(XOR(a,b), AND(a,b)) - uses 1 AND
    // Or directly: OR gate if supported
    const out = this.wireCount++;
    this.gates.push({ inputs: [a, b], outputs: [out], type: 'OR' });
    return out;
  }

  // Composite: 2-to-1 MUX
  // out = sel ? b : a
  mux(sel, a, b) {
    // MUX = XOR(a, AND(sel, XOR(a, b)))
    const xorAB = this.xorGate(a, b);
    const andSel = this.andGate(sel, xorAB);
    return this.xorGate(a, andSel);
  }

  // N-bit MUX (select between two N-bit values)
  muxN(sel, aBits, bBits) {
    const n = aBits.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(this.mux(sel, aBits[i], bBits[i]));
    }
    return out;
  }

  // Full adder: returns [sum, carry]
  fullAdder(a, b, cin) {
    const axorb = this.xorGate(a, b);
    const sum = this.xorGate(axorb, cin);
    const aAndb = this.andGate(a, b);
    const axorbAndCin = this.andGate(axorb, cin);
    const cout = this.xorGate(aAndb, axorbAndCin); // OR via XOR since inputs mutually exclusive
    return [sum, cout];
  }

  // N-bit adder (ripple carry)
  adderN(aBits, bBits, carryIn = null) {
    const n = aBits.length;
    const sumBits = [];
    let carry = carryIn;
    
    // If no carry in provided, create a constant 0 wire
    if (carry === null) {
      carry = this.constantZero();
    }

    for (let i = 0; i < n; i++) {
      const [sum, cout] = this.fullAdder(aBits[i], bBits[i], carry);
      sumBits.push(sum);
      carry = cout;
    }
    
    return { sum: sumBits, carry };
  }

  // Constant 0: XOR a wire with itself (need a dummy input or use first input)
  // For simplicity, we'll use a dedicated constant wire approach
  constantZero() {
    // Create a constant by XORing any wire with itself
    // We need at least one input wire to exist
    if (this.inputWires.length > 0) {
      const w = this.inputWires[0];
      return this.xorGate(w, w); // Always 0
    }
    throw new Error('Need at least one input wire for constants');
  }

  constantOne() {
    const zero = this.constantZero();
    return this.invGate(zero);
  }

  // N-bit subtractor: a - b using two's complement
  // result = a + (~b) + 1
  subtractorN(aBits, bBits) {
    const n = aBits.length;
    
    // Invert b
    const bInv = bBits.map(b => this.invGate(b));
    
    // Add with carry-in = 1 (two's complement)
    const one = this.constantOne();
    const { sum } = this.adderN(aBits, bInv, one);
    
    return sum;
  }

  // N-bit equality check: returns 1 if a == b
  equalN(aBits, bBits) {
    const n = aBits.length;
    
    // XOR each pair, then NOR all results
    let allEqual = this.constantOne();
    
    for (let i = 0; i < n; i++) {
      const diff = this.xorGate(aBits[i], bBits[i]);
      const same = this.invGate(diff);
      allEqual = this.andGate(allEqual, same);
    }
    
    return allEqual;
  }

  // N-bit inequality: returns 1 if a != b
  notEqualN(aBits, bBits) {
    const equal = this.equalN(aBits, bBits);
    return this.invGate(equal);
  }

  // Simple N-bit multiplier (array multiplier)
  // This is O(n²) gates but simple
  multiplierN(aBits, bBits) {
    const n = aBits.length;
    
    // Partial products
    let partials = [];
    
    for (let i = 0; i < n; i++) {
      const partial = [];
      // Shift: i zeros at the start
      for (let s = 0; s < i; s++) {
        partial.push(this.constantZero());
      }
      // AND each bit of a with b[i]
      for (let j = 0; j < n; j++) {
        partial.push(this.andGate(aBits[j], bBits[i]));
      }
      // Pad to 2n bits
      while (partial.length < 2 * n) {
        partial.push(this.constantZero());
      }
      partials.push(partial);
    }

    // Sum all partials
    let result = partials[0];
    for (let i = 1; i < partials.length; i++) {
      const { sum } = this.adderN(result, partials[i]);
      // Extend to 2n bits
      while (sum.length < 2 * n) {
        sum.push(this.constantZero());
      }
      result = sum;
    }

    return result;
  }

  // Mark output wires
  setOutputs(wires) {
    this.outputWires = wires;
  }

  // Generate Bristol format
  toBristol() {
    const lines = [];
    
    // Header: num_gates num_wires
    lines.push(`${this.gates.length} ${this.wireCount}`);
    
    // Second line: input counts and output count (Bristol fashion)
    // Format: num_inputs input_sizes... num_outputs output_sizes...
    // Simplified: we have one big input block and one output
    lines.push(`${this.inputWires.length} ${this.outputWires.length}`);
    
    // Gates
    for (const gate of this.gates) {
      const numIn = gate.inputs.length;
      const numOut = gate.outputs.length;
      const inWires = gate.inputs.join(' ');
      const outWires = gate.outputs.join(' ');
      lines.push(`${numIn} ${numOut} ${inWires} ${outWires} ${gate.type}`);
    }
    
    return lines.join('\n');
  }

  // Stats
  getStats() {
    let andCount = 0;
    let xorCount = 0;
    let invCount = 0;
    let orCount = 0;
    
    for (const gate of this.gates) {
      switch (gate.type) {
        case 'AND': andCount++; break;
        case 'XOR': xorCount++; break;
        case 'INV': invCount++; break;
        case 'OR': orCount++; break;
      }
    }
    
    return {
      totalGates: this.gates.length,
      andGates: andCount,
      xorGates: xorCount,
      invGates: invCount,
      orGates: orCount,
      freeGates: xorCount + invCount,
      nonFreeGates: andCount + orCount,
      wireCount: this.wireCount,
      inputBits: this.inputWires.length,
      outputBits: this.outputWires.length
    };
  }
}

/**
 * Build the rPNL fraud proof circuit
 * 
 * Inputs (all 32-bit for simplicity, scale to 64 for production):
 *   - avgEntry: 32 bits (fixed point, 16.16)
 *   - tradePrice: 32 bits
 *   - amount: 32 bits
 *   - isBuyer: 1 bit
 *   - claimedPNL: 32 bits (signed)
 * 
 * Output:
 *   - fraud: 1 bit (1 = invalid PNL)
 */
function buildRPNLFraudCircuit(bitWidth = 32) {
  const circuit = new BristolCircuit();

  // Allocate inputs
  const avgEntry = circuit.addInputs(bitWidth);      // wires 0-31
  const tradePrice = circuit.addInputs(bitWidth);    // wires 32-63
  const amount = circuit.addInputs(bitWidth);        // wires 64-95
  const isBuyer = circuit.addInputs(1)[0];           // wire 96
  const claimedPNL = circuit.addInputs(bitWidth);    // wires 97-128

  // Step 1: Compute both possible deltas
  // longDelta = tradePrice - avgEntry (profit if positive for longs)
  const longDelta = circuit.subtractorN(tradePrice, avgEntry);
  
  // shortDelta = avgEntry - tradePrice (profit if positive for shorts)
  const shortDelta = circuit.subtractorN(avgEntry, tradePrice);

  // Step 2: Select delta based on isBuyer
  // delta = isBuyer ? longDelta : shortDelta
  const delta = circuit.muxN(isBuyer, shortDelta, longDelta);

  // Step 3: Multiply delta * amount
  // Result is 2*bitWidth bits, we take lower bitWidth for now
  // (In production, handle overflow/fixed-point properly)
  const product = circuit.multiplierN(delta, amount);
  const expectedPNL = product.slice(0, bitWidth); // Truncate to bitWidth

  // Step 4: Compare expectedPNL != claimedPNL
  const fraud = circuit.notEqualN(expectedPNL, claimedPNL);

  // Set output
  circuit.setOutputs([fraud]);

  return circuit;
}

// Generate the circuit
const circuit = buildRPNLFraudCircuit(32);
const bristol = circuit.toBristol();
const stats = circuit.getStats();

console.log('=== rPNL Fraud Proof Circuit ===\n');
console.log('Stats:');
console.log(JSON.stringify(stats, null, 2));
console.log('\n=== Bristol Format ===\n');
console.log(bristol);

// Also write to file
const fs = require('fs');
fs.writeFileSync('/home/claude/rpnl-fraud-proof/rpnl_fraud.bristol', bristol);
fs.writeFileSync('/home/claude/rpnl-fraud-proof/stats.json', JSON.stringify(stats, null, 2));

console.log('\n\nFiles written:');
console.log('  - rpnl_fraud.bristol');
console.log('  - stats.json');
