/*
  Copyright (c) 2010 - 2017, Nordic Semiconductor ASA
  All rights reserved.
  Redistribution and use in source and binary forms, with or without modification,
  are permitted provided that the following conditions are met:
  1. Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.
  2. Redistributions in binary form, except as embedded into a Nordic
     Semiconductor ASA integrated circuit in a product or a software update for
     such product, must reproduce the above copyright notice, this list of
     conditions and the following disclaimer in the documentation and/or other
     materials provided with the distribution.
  3. Neither the name of Nordic Semiconductor ASA nor the names of its
     contributors may be used to endorse or promote products derived from this
     software without specific prior written permission.
  4. This software, with or without modification, must only be used with a
     Nordic Semiconductor ASA integrated circuit.
  5. Any software provided in binary form under this license must not be reverse
     engineered, decompiled, modified and/or disassembled.
  THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS
  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  OF MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
  GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
  HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
  LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
  OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import EventTarget from "./EventTarget.js";

class FeatureOperations extends EventTarget {
  constructor(device, type) {
    super();
    this.device = device;
    this.type = type || this.constructor.name;
    this.latestReading = new Map(); 
  }

  async connect() {
    if (this.getGattAvailable()) {
      try {
        this.setGattBusy();

        this.service.service = await this.device.server.getPrimaryService(this.service.uuid);

        this.characteristic.characteristic = await this.service.service.getCharacteristic(this.characteristic.uuid);
        this.characteristic.connected = true;
        this.characteristic.notifying = false;

        this.setGattAvailable();
  
        if (this.characteristic.verifyAction && this.characteristic.verifyReaction) {
          await this.characteristic.verifyAction();

          this.addEventListener("verifyReaction", this.characteristic.verifyReaction);

          await this._notify(true, true);
        }

        console.log(`Connected to the ${this.type} feature`);
      } catch (error) {
        this.setGattAvailable();

        this.characteristic.connected = false;
        this.postponeOperation("connect", this.connect.bind(this));
      }
    } else {
      this.postponeOperation("connect", this.connect.bind(this));
    }
  }

  async _read(returnRaw = false) {
    if (!this.characteristic.connected) {
      await this.connect();
    }
  
    if (!this.hasProperty("read")) {
      const e = new Error(`The ${this.type} feature does not support the read method`);
      throw e;
    }

    if (!this.characteristic.decoder) {
      const e = new Error("The characteristic you're trying to write does not have a specified decoder");
      throw e;
    }

    let retries = 0;

    const f = async () => {
      if (!this.getGattAvailable()) {
        if (retries === 3) {
          this.device.dispatchOperationCancelledEvent(this.type, "read");
        } else {
          await setTimeout(async () => {
            retries++;
  
            await f();
          }, 500)
        }
      } else {
        try {
          this.setGattBusy();

          if (returnRaw === true) {
            const rawProp = await this.characteristic.characteristic.readValue();
            
            this.setGattAvailable();

            return Promise.resolve(rawProp);
          } else {
            const prop = await this.characteristic.characteristic.readValue();
            
            this.setGattAvailable();

            return Promise.resolve(this.characteristic.decoder(prop));
          }
        } catch (error) {
          this.setGattAvailable();
          this.processError(error);
        }
      }
    }

    await f();
  }

  async _write(prop) {
    if (prop === undefined) {
      const e = new Error("You have to write a non-empty body");
      throw e;
    }

    if (!this.characteristic.connected) {
      await this.connect();
    }

    if (!this.hasProperty("write")) {
      const e = new Error(`The ${this.type} feature does not support the write method`);
      throw e;
    }

    if (!this.characteristic.encoder) {
      const e = new Error("The characteristic you're trying to write does not have a specified encoder");
      throw e;
    }

    let retries = 0;

    const f = async () => {
      if (!this.getGattAvailable()) {
        if (retries === 3) {
          this.device.dispatchOperationCancelledEvent(this.type, "write");
        } else {
          await setTimeout(async () => {
            retries++;
  
            await f();
          }, 500)
        }
      } else {
        try {
          const encodedValue = await this.characteristic.encoder(prop);
          this.setGattBusy();

          await this.characteristic.characteristic.writeValue(encodedValue);
          
          this.setGattAvailable();

          return;
        } catch (error) {
          this.setGattAvailable();
          this.processError(error);
        }
      }
    }

    await f();
  }

  async _notify(enable, verify = false) {
    if (!(enable === true || enable === false)) {
      const e = new Error("You have to specify the enable parameter (true/false)");
      throw e;
    }

    if (!this.characteristic.connected) {
      await this.connect();
    }

    if (!this.hasProperty("notify")) {
      const e = new Error(`The ${this.type} feature does not support the start/stop methods`);
      throw e;
    }

    if (enable === this.characteristic.notifying) {
      console.log(`The ${this.type} feature has already ${(this.characteristic.notifying ? "enabled" : "disabled")} notifications`);
      return;
    }

    // maybe we can't bind this function if we want the eventListener to be removed properly
    const onReading = (e) => {
      const eventData = e.target.value;
      const decodedData = this.characteristic.decoder(eventData);

      let ce;

      if (verify) {
        ce = new CustomEvent("verifyReaction", {detail: {feature: this.type, data: decodedData}});
        this.dispatchEvent(ce);
      } else {
        this.latestReading.clear();

        for (let elem in decodedData) {
          this.latestReading.set(elem, decodedData[elem]);
        }

        const e = new Event("reading");
        this.dispatchEvent(e);

        ce = new CustomEvent("characteristicvaluechanged", {detail: {feature: this.type, data: decodedData}});
        this.device.dispatchEvent(ce);
      }
    };

    if (!this.characteristic.decoder) {
      const e = new Error("The characteristic you're trying to notify does not have a specified decoder");
      throw e;
    }

    const characteristic = this.characteristic.characteristic;

    if (this.getGattAvailable()) {
      if (enable) {
        try {
          this.setGattBusy();

          const csn = await characteristic.startNotifications();
          csn.addEventListener("characteristicvaluechanged", onReading.bind(this));
          this.setGattAvailable();
          this.characteristic.notifying = true;
          console.log(`Notifications enabled for the ${this.type} feature`);
        } catch (error) {
          this.characteristic.notifying = false;
          this.setGattAvailable();
          this.postponeOperation("notify", this._notify.bind(this, enable, verify));
          throw error;
        }
      } else {
        try {
          this.setGattBusy();
          const csn = await characteristic.stopNotifications();
          csn.removeEventListener("characteristicvaluechanged", onReading.bind(this));
          
          this.setGattAvailable();

          this.characteristic.notifying = false;
          console.log(`Notifications disabled for the ${this.type} feature`);
        } catch (error) {
          this.characteristic.notifying = true;
          this.setGattAvailable();
          this.postponeOperation("notify", this._notify.bind(this, enable, verify));
          this.processError(error);
        }
      }
    } else {
      this.postponeOperation("notify", this._notify.bind(this, enable, verify));
    }
  }

  hasProperty(property) {
    return (this.characteristic.characteristic.properties[property] === true ? true : false);
  }

  async start() {
    try {
      await this._notify(true);
    } catch (error) {
      this.processError(error);
    }
  }

  async stop() {
    try {
      await this._notify(false);
    } catch (error) {
      this.processError(error);
    }
  }

  async read() {
    try {
      const val = await this._read();
      return val;
    } catch (error) {
      this.processError(error);
    }
  }

  async write(data) {
    try {
      await this._write(data);
    } catch (error) {
      this.processError(error);
    }
  }

  
  setGattBusy() {
    window.thingyController[this.device.device.id].gattBusy = true;
  }

  setGattAvailable() {
    window.thingyController[this.device.device.id].gattBusy = false;

    this.device.dispatchEvent(new Event("gattavailable"));
  }

  getGattAvailable() {
    // awkward format with the not, but more intuitive
    return !window.thingyController[this.device.device.id].gattBusy;
  }

  postponeOperation(methodName, method) {
    window.thingyController[this.device.device.id].operationQueue.push({feature: this.type, methodName, method});
  }

  processError(error) {
    console.error(`The ${this.type} feature has reported an error: ${error}`);

    const ce = new CustomEvent("error", {detail: {
      feature: this.type,
      error
    }});

    this.device.dispatchEvent(ce);
  }
}

export default FeatureOperations;
