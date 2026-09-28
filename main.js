'use strict';

/*
 * Created with @iobroker/create-adapter v1.23.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const ping = require('ping');
const jsonLogic = require('./lib/json_logic.js');
const axios = require('axios');
const http = require('http');
const url = require('url');

class Robonect extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'robonect',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.robonectIp;
        this.username;
        this.password;

        this.statusInterval;
        this.infoInterval;

        this.restPeriod1Start;
        this.restPeriod1End;
        this.restPeriod2Start;
        this.restPeriod2End;

        this.currentStatus;

        this.batteryPollType;
        this.doorPollType;
        this.errorsPollType;
        this.extensionPollType;
        this.gpsPollType;
        this.hoursPollType;
        this.motorPollType;
        this.portalPollType;
        this.pushPollType;
        this.timerPollType;
        this.versionPollType;
        this.weatherPollType;
        this.wlanPollType;

        this.infoTimeout;
        this.statusTimeout;
        this.ignError;
        this.occError;
        this.ignPing;
        this.failedPing;
        // http-server for Robonect PushService
        this.ps;
        this.ps_host;
        this.ps_port;
    }


    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        if (this.config.robonectIp === undefined || this.config.robonectIp === '') {
            // todo: Support FQDN in addition
            this.log.error('No IP address set. Adapter will not be executed.');
            await this.setState('info.connection', false, true);

            return;
        }

        this.robonectIp = this.config.robonectIp;
        this.username = this.config.username;
        this.password = this.config.password;

        this.statusInterval = this.config.statusInterval;
        this.infoInterval = this.config.infoInterval;

        this.restPeriod1Start = this.config.restPeriod1Start;
        this.restPeriod1End = this.config.restPeriod1End;
        this.restPeriod2Start = this.config.restPeriod2Start;
        this.restPeriod2End = this.config.restPeriod2End;

        this.batteryPollType = this.config.batteryPollType;
        this.doorPollType = this.config.doorPollType;
        this.errorsPollType = this.config.errorsPollType;
        this.extensionPollType = this.config.extensionPollType;
        this.gpsPollType = this.config.gpsPollType;
        this.hoursPollType = this.config.hoursPollType;
        this.motorPollType = this.config.motorPollType;
        if (this.config.pushService) {
            this.pushPollType = 'info';
        } else {
            this.pushPollType = this.config.pushPollType;
        }
        this.portalPollType = this.config.portalPollType;
        this.timerPollType = this.config.timerPollType;
        this.versionPollType = this.config.versionPollType;
        this.weatherPollType = this.config.weatherPollType;
        this.wlanPollType = this.config.wlanPollType;
        //
        this.ps_host = this.config.pushServiceIp;
        this.ps_port = this.config.pushServicePort;
        this.apiUrl = `http://${this.robonectIp}/api/json`;
        //
        this.ignError = this.config.errMain;
        this.occError = 0;
        this.ignPing = this.config.errPing;
        this.failedPing = 0;
        //
        if (isNaN(this.statusInterval) || this.statusInterval < 1) {
            this.statusInterval = 60;
            this.log.warn('No status interval set. Using default value (60 seconds).');
        }

        if (isNaN(this.infoInterval) || this.infoInterval < 1) {
            this.infoInterval = 900;
            this.log.warn('No info interval set. Using default value (900 seconds).');
        }

        if (this.restPeriod1Start === '' && this.restPeriod1End === '') {
            this.log.info('Rest period 1 not configured. Period will be ignored.');
        } else if (this.isValidTimeFormat(this.restPeriod1Start) === false || this.isValidTimeFormat(this.restPeriod1End) === false) {
            this.restPeriod1Start = '';
            this.restPeriod1End = '';
            this.log.error('Rest period 1 not configured correctly. Period will be ignored.');
        } else {
            this.log.warn('Rest period 1 configured (' + this.restPeriod1Start + ' - ' + this.restPeriod1End + '). Only API call /json?cmd=status will be done.'                                                    );
        }

        if (this.restPeriod2Start === '' && this.restPeriod2End === '') {
            this.log.info('Rest period 2 not configured. Period will be ignored.');
        } else if (this.isValidTimeFormat(this.restPeriod2Start) === false || this.isValidTimeFormat(this.restPeriod2End) === false) {
            this.restPeriod2Start = '';
            this.restPeriod2End = '';
            this.log.error('Rest period 2 not configured correctly. Period will be ignored.');
        } else {
            this.log.warn('Rest period 2 configured (' + this.restPeriod2Start + ' - ' + this.restPeriod2End + '). Only API call /json?cmd=status will be done.'                                                    );
        }

        await this.testPushServiceConfig();

        this.currentStatus = null;

        // Inititalize objects
        await this.initializeObjects();

        this.subscribeStates('*');

        // Do the initial polling
        await this.updateRobonectData('Initial');


        // test whether to use robonect push service
        if (this.config.pushService){
            this.initPushServiceServer();
        }

        // Start regular pollings
        const pollStatus = () => {
            this.updateRobonectData('Status');

            this.statusTimeout = setTimeout(pollStatus, this.statusInterval * 1000);
        };

        if (this.statusInterval > 0) {
            this.statusTimeout = setTimeout(pollStatus, this.statusInterval * 1000);
        }

        const pollInfo = () => {
            this.updateRobonectData('Info');

            this.infoTimeout = setTimeout(pollInfo, this.infoInterval * 1000);
        };

        if (this.infoInterval > 0) {
            this.infoTimeout = setTimeout(pollInfo, this.infoInterval * 1000);
        }

        // this.log.info('Done');

        return true;
    }

    initPushServiceServer() {
        const adapter = this;
        // http-Server for Robonect PushService
        const requestListener = function (req, res) {
            let params;
            if (req.method === 'GET') {
                adapter.log.debug(`Received GET request`);
                adapter.log.debug(`req.url=[${req.url}]`);
                params = url.parse(req.url, true).query;
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end();
            } else if (req.method === 'POST') {
                adapter.log.debug(`Received POST request`);
                adapter.log.debug(`req.url=[${req.url}]`);
                let body = '';
                req.on('data', function (chunk) {
                    body += chunk;
                });
                req.on('end', function () {
                    params = url.parse(req.url, true).query;
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(body);
                    adapter.log.debug(`body=[${params}]`);
                });
            }
            const objects = require('./lib/objects_pushedStatus.json');
            params.stopped = (params.stopped === 1);
            adapter.updateObjects(objects, params);

        };

        const pushService = http.createServer(requestListener);
        pushService.listen(this.ps_port, this.ps_host, () => {
            this.log.info(`Server for Robonect push-service is listening on http://${this.ps_host}:${this.ps_port}`);
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            clearTimeout(this.infoTimeout);
            clearTimeout(this.statusTimeout);

            this.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (typeof state == 'object' && !state.ack) {
            // The state changed
            const trigger = id.split('.', 3).pop();
            if (id === this.namespace + '.error.clear') {
                this.updateErrorClearReset(true, false);
            } else if (id === this.namespace + '.error.reset') {
                this.updateErrorClearReset(false, true);
            } else if (id === this.namespace + '.extension.gpio1.status') {
                this.updateExtensionStatus('gpio1', state.val);
            } else if (id === this.namespace + '.extension.gpio2.status') {
                this.updateExtensionStatus('gpio2', state.val);
            } else if (id === this.namespace + '.extension.out1.status') {
                this.updateExtensionStatus('out1', state.val);
            } else if (id === this.namespace + '.extension.out2.status') {
                this.updateExtensionStatus('out2', state.val);
            } else if (id === this.namespace + '.status.mode') {
                this.updateMode(state.val);
            }
            switch (trigger){
                case 'name':
                    this.sendApiCmd(`cmd=name&name=${state.val}`)
                        .catch((err) => {
                            this.doErrorHandling(err);
                        });
                    break;
                case 'push':
                    this.handlePushUpdate(id, state.val);
                    break;
                case 'service':
                    if (state.val !== '') this.sendApiCmd('cmd=service&'+state.val)
                        .catch((err) => {
                            this.doErrorHandling(err);
                        });
                    break;
                case 'start':
                    this.sendApiCmd('cmd=start')
                        .catch((err) => {
                            this.doErrorHandling(err);
                        });

                    this.sendApiCmd('cmd=status', true);
                    break;
                case 'stop':
                    this.sendApiCmd('cmd=stop', false)
                        .catch((err) => {
                            this.doErrorHandling(err);
                        });
                    this.sendApiCmd('cmd=status', true)
                        .catch((err) => {
                            this.doErrorHandling(err);
                        });
                    break;
                case 'timer':
                    if (id.split('.').pop() === 'update_timer'){
                        this.handleTimerUpdate(id);
                    }
                    break;
                default:
                    break;
            }
        }
    }

    async handlePushUpdate(id, value){
        this.log.debug(`Received push update for ID:${id} - new value: ${value}`);
        /*
         * /json?cmd=push&url=192.168.1.1:80
         * /json?cmd=push&interval=n (n Sekunden)
         * /json?cmd=push&trigger%i=[0 (AUS), 1 (Enter EIN, Leave AUS), 2 (Enter AUS Leave EIN), 3 (Enter EIN, Leave EIN)]
         * ....mit i=0..9
         * Info: Die einzelnen Anweisungen können verkettet werden; z.B.: /json?cmd=push&trigger0=1&trigger4=3
         * &mode=get oder mode=post (deaktivieren hab ich noch nicht rausgefunden)
         * name="LegoSpieler" (name="" deaktiviert Benutzerdaten)
         * pass="12345678"
         */
        let result = 0;
        // id = robonect.0.push.trigger.0.enter
        const triggerNum=id.split('.', 5).pop();
        const basePath=id.split('.', 5).join('.');
        let command= '';
        switch (id.split('.').pop()) {
            case 'interval':
                command = `push&interval=${value}`;
                break;
            case 'enter': {
                const leave = await this.getStateAsync(`${basePath}.leave`);
                if (value) {
                    result += 1;
                }
                if (leave.val) {
                    result += 2;
                }
                command = `push&trigger${triggerNum}=${result}`;
                break;
            }
            case 'leave': {
                const enter = await this.getStateAsync(`${basePath}.enter`);
                if (value) {
                    result += 2;
                }
                if (enter.val) {
                    result += 1;
                }
                command = `push&trigger${triggerNum}=${result}`;
                break;
            }
        }
        try {
            await this.sendApiCmd(command);
            await this.sendApiCmd('cmd=push', true);
        }
        catch(err){
            this.log.warn(`Sending the command ${command} failed with: ${err}`);
        }
    }


    async handleTimerUpdate(id){
        /**
         * /json?cmd=Timer
         * ....Timer
         * ........0..13
         * ............id
         * ............enabled
         * ............start
         * ............end
         * ............weekdays
         * ................mo
         * ................tu
         * ................we
         * ................th
         * ................fr
         * ................sa
         * ................su
         * ........save=1 // Sichert die Daten im Roboter <Danke an kobelka>
         *
         * /json?cmd=Timer&Timer=1&start=06:00&end=09:00&mo=1&tu=1&we=1&th=1&fr=1&sa=1&su=1&enable=1
         */
        // robonect.0.timer.0.id
        const timer = Number.parseInt(id.split('.', 4).pop())+1;
        const basePath = id.split('.', 4).join('.');
        let cmd = `cmd=timer&timer=${timer}&save=1`;
        try {
            cmd += '&enable=' + ((await this.getValueAsync(`${basePath}.enabled`)) ? '1' : '0');
            cmd += '&start=' + (await this.getValueAsync(`${basePath}.start_time`));
            cmd += '&end=' + (await this.getValueAsync(`${basePath}.end_time`));
            // robonect.0.timer.0.weekdays.friday
            cmd += '&mo=' + ((await this.getValueAsync(`${basePath}.weekdays.monday`)) ? '1' : '0');
            cmd += '&tu=' + ((await this.getValueAsync(`${basePath}.weekdays.tuesday`)) ? '1' : '0');
            cmd += '&we=' + ((await this.getValueAsync(`${basePath}.weekdays.wednesday`)) ? '1' : '0');
            cmd += '&th=' + ((await this.getValueAsync(`${basePath}.weekdays.thursday`)) ? '1' : '0');
            cmd += '&fr=' + ((await this.getValueAsync(`${basePath}.weekdays.friday`)) ? '1' : '0');
            cmd += '&sa=' + ((await this.getValueAsync(`${basePath}.weekdays.saturday`)) ? '1' : '0');
            cmd += '&su=' + ((await this.getValueAsync(`${basePath}.weekdays.sunday`)) ? '1' : '0');
        }
        catch(err){
            this.log.error(err);
        }
        try {
            await this.sendApiCmd(cmd);
            await this.sendApiCmd('cmd=timer', true);
        }
        catch(err){
            this.log.warn(`Sending the command ${cmd} failed with: ${JSON.stringify(err)}`);
        }
    }

    async getValueAsync(id){
        return new Promise(async (resolve, reject) => {
            this.log.silly(`getValueAsync for id: ${id}`);
            const state = await this.getStateAsync(id);
            if (state){
                this.log.silly(`Returning value: ${state.val}`);
                resolve (state.val);
            } else {
                reject(`The ID: ${id} has no value. Please fix.`);
            }
        });
    }

    async testPushServiceConfig(){
        this.getValueAsync(`push.server_url`)
            .then((url) => {
                if (this.config.pushService && (url !== `${this.config.pushServiceIp}:${this.config.pushServicePort}`)
                    && (this.config.pushServiceIp !== `0.0.0.0`) // listen to all IPV4 adresses
                    && (this.config.pushServiceIp !== `::`)      // listen to all IPV6 adresses
                ) {
                    this.log.warn(`Push Service is enabled in config, but misconfigured. Please update your Robonect Push-Service configuration.`);
                    this.log.warn(`The configured URL in your Robonect is: [${url}] -> but should be: ${this.config.pushServiceIp}:${this.config.pushServicePort                                                    }`);
                }
            })
            .catch((err)=> {
                this.log.error(err);
            });
    }

    /**
     * Is called to initialize objects
     */
    async initializeObjects() {
        const objects_battery = require('./lib/objects_battery.json');
        const objects_door = require('./lib/objects_door.json');
        const objects_error = require('./lib/objects_error.json');
        const objects_remerr = require('./lib/objects_remerr.json');
        const objects_ext = require('./lib/objects_ext.json');
        const objects_gps = require('./lib/objects_gps.json');
        const objects_hour = require('./lib/objects_hour.json');
        const objects_motor = require('./lib/objects_motor.json');
        const objects_portal = require('./lib/objects_portal.json');
        const objects_push = require('./lib/objects_push.json');
        const objects_status = require('./lib/objects_status.json');
        const objects_timer = require('./lib/objects_timer.json');
        const objects_version = require('./lib/objects_version.json');
        const objects_weather = require('./lib/objects_weather.json');
        const objects_wlan = require('./lib/objects_wlan.json');
        const objects_commands = require('./lib/objects_commands.json');

        const objects = {
            ...objects_battery,
            ...objects_door,
            ...objects_error,
            ...objects_remerr,
            ...objects_ext,
            ...objects_gps,
            ...objects_hour,
            ...objects_motor,
            ...objects_portal,
            ...objects_push,
            ...objects_status,
            ...objects_timer,
            ...objects_version,
            ...objects_weather,
            ...objects_wlan,
            ...objects_commands,
        };

        for (const id in objects) {
            if (objects[id].type && objects[id].common && objects[id].native) {
                const object = {};
                object.type = objects[id].type;
                object.common = objects[id].common;
                object.native = objects[id].native;

                await this.setObjectAsync(id, object);

                this.log.silly('Object \'' + id + '\' created');
            }
        }
    }

    /**
     * Is called to update data
     * @param {string} pollType
     */
    async updateRobonectData(pollType) {
        let hostOnline= false;
        const adapter = this;
        if (this.config.pingFirst){
            await ping.sys.probe(this.robonectIp, async function (isAlive) {
                hostOnline = isAlive;
                adapter.log.debug(`Adapter is configured to ping the robonect device - and it's ${hostOnline? '':'not'} online.`);
                if (hostOnline) adapter.failedPing = 0;
            });
        } else {
            // no pingFirst configured - assume device to be online
            hostOnline = true;
            adapter.log.debug('Adapter is configured not to ping the robonect device - assuming it´s online.');
        }
        if (hostOnline) {
            let doRegularPoll = false;
            const isRestTime = adapter.isRestTime();
            if (pollType === 'Initial') {
                await adapter.setState('error.clear', { val: false, ack: true });
                await adapter.setState('error.reset', { val: false, ack: true });
                await adapter.setState('error.code', { val: 0, ack: true });
                await adapter.setState('error.message', { val: 'no error', ack: true });
            }
            await adapter.setState('last_sync', {val: adapter.formatDate(new Date(), 'YYYY-MM-DD hh:mm:ss'), ack: true});
            await adapter.setState('online', {val: hostOnline, ack: true});
            await adapter.setState('rest_time', {val: isRestTime, ack: true});
            await adapter.setState('info.connection', {val: hostOnline, ack: true});

            adapter.log.debug('Polling started');

            // Poll status
            await adapter.sendApiCmd('cmd=status', true)
                .then((data) => {
                    adapter.log.silly(`Data from poll: ${JSON.stringify(data)}`);
                    adapter.currentStatus = data['status']['status'];
                    adapter.occError = 0;
                })
                .catch((err) => {
                    // adapter.log.error(`Polling robonect status: ${JSON.stringify(err)}`);
                    adapter.doErrorHandling(err);
                });

            if (isRestTime === false) {
                if (adapter.currentStatus != null && adapter.currentStatus !== 16 /*abgeschaltet*/ && adapter.currentStatus !== 17 /*schlafen*/) {
                    doRegularPoll = true;
                }
            }
            adapter.log.debug('pollType: ' + pollType);
            adapter.log.debug('isRestTime: ' + isRestTime);
            adapter.log.debug('currentStatus: ' + adapter.currentStatus);
            adapter.log.debug('doRegularPoll: ' + doRegularPoll);
            try {
                if (adapter.batteryPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.batteryPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=battery', true);
                if (adapter.doorPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.doorPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=door', true);
                if (adapter.errorsPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.errorsPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=error', true);
                if (adapter.extensionPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.extensionPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=ext', true);
                if (adapter.gpsPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.gpsPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=gps', true);
                if (adapter.hoursPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.hoursPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=hour', true);
                if (adapter.motorPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.motorPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=motor', true);
                if (adapter.portalPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.portalPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=portal', true);
                if (adapter.pushPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.pushPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=push', true);
                if (adapter.timerPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.timerPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=timer', true);
                if (adapter.versionPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.versionPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=version', true);
                if (adapter.weatherPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.weatherPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=weather', true);
                if (adapter.wlanPollType !== 'NoPoll' && (pollType === 'Initial' || (adapter.wlanPollType === pollType && doRegularPoll)))
                    await adapter.sendApiCmd('cmd=wlan', true);
                adapter.log.debug('Polling done');
            }
            catch (err) {
                if (pollType === 'Initial') {
                         adapter.log.debug('Initial polling failed, try again after 5 seconds...');
                    setTimeout(() => { this.updateRobonectData('Initial') }, 5000);
                } else {
                    adapter.doErrorHandling(err);
                }
            }
        } else {
            adapter.failedPing++;
            if (adapter.failedPing >= adapter.ignPing) {
               adapter.log.warn('No connection to lawn mower (Not able to ping it). Check network connection.');
               adapter.failedPing = 0;
            }
        }
    }

    doErrorHandling(err){
        try {
            this.log.debug('Data received for error handling: '+JSON.stringify(err));
            const errorCode = err.error_code || (err.response? err.response.status : -666);
            const errorMessage = err.error_message || err.message;
            this.log.silly(errorMessage);
            switch (errorCode) {
                case 7 : // Automower already stopped
                    this.log.info(errorMessage);
                    break;
                case 253 : { // No GPS installed
                    this.gpsPollType = 'NoPoll';
                    this.log.warn(`Your lawn mower dosen't support GPS. Deactivated polling of GPS. You should deactivate it in the adapters configuration.`);
                    break;
                }
                case 401 : {
                    this.log.error('Your Robonect has denied access due to incorrect credentials.');
                    this.log.error(`You used: Username=${this.username} for login. Please double check your credentials.`);   // never log the password
                    this.terminate(11);
                    break;
                }
                default: {
                    this.occError++;
                    if (this.occError >= this.ignError) {
                       this.log.warn('Error returned from Robonect device: '+JSON.stringify(err));
                       this.occError = 0;
                    }
                    break;
                }
            }
        } catch(error){
            this.log.error('Error during error handling: '+JSON.stringify(error));
        }
    }

    /**
     *
     * @param command {string}
     * @returns {{}}
     */
    getParamsObj(command){
        //cmd=timer&timer=1&save=1&enable=1&start=09:00&end=11:00&mo=1&tu=1&we=1&th=1&fr=1&sa=1&su=1
        const result = {};
        const cmdArray = command.split('&');
        for (const cmd of cmdArray){
            const param = cmd.split('=');
            result[param[0]]=param[1];
        }
        return result;
    }


    /**
     * Is called to poll the Robonect module
     * @param cmd {string}
     * @param updateObjectsAfterCall {boolean}
     */
    async sendApiCmd(cmd, updateObjectsAfterCall) {
        updateObjectsAfterCall = updateObjectsAfterCall || false;
        const adapter = this;
        const PARAMS = this.getParamsObj(cmd); //{cmd: cmd};
        if (updateObjectsAfterCall) {
            this.log.debug(`Polling API for data [${JSON.stringify(PARAMS)}] started`);
        } else {
            this.log.debug(`Sending of command [${JSON.stringify(PARAMS)}] started`);
        }
        return new Promise((resolve, reject) => {
            axios.get(adapter.apiUrl,  {auth: {username: this.username, password: this.password}, params: PARAMS})
                .then( function (response){
                    adapter.log.debug('Data returned from robonect device: '+JSON.stringify(response.data));
                    if (response.data.successful === true) {
                        if (updateObjectsAfterCall){
                            const objects = require('./lib/objects_' + PARAMS.cmd + '.json');
                            adapter.updateObjects(objects, response.data);
                        }
                        adapter.log.debug(`Sending of command [${cmd}] - done!`);
                        resolve(response.data);
                    } else {
                        adapter.log.debug(`Sending of command [${cmd}] - failed!`);
                        reject(response.data);
                    }
                })
                .catch((err)=>{
                    this.log.silly(`Axios says: ${err}`);
                    adapter.log.silly('Error-data returned from axios: '+JSON.stringify(err));
                    reject(err);
                });
        });
    }

    /**
     * Update/Set errors
     * @param {boolean} clear
     * @param {boolean} reset
     */
    updateErrorClearReset(clear, reset) {
        const adapter = this;
        const PARAMS = {cmd: 'error', clear:0, reset:0};
        if (clear) PARAMS.clear = 1;
        if (reset) PARAMS.reset = 1;
        axios.get(adapter.apiUrl, {auth: {username: this.username, password: this.password}, params: PARAMS})
            .then((response)=>{
                try {
                    if (response.data.successful === true) {
                        adapter.setState('error.clear', { val: false, ack: true });
                        adapter.setState('error.reset', { val: false, ack: true });
                        if (reset && response.data.error_code === 13) {
                            this.log.info('Trying to reset status....');
                            PARAMS.cmd = 'status';
                            axios.get(adapter.apiUrl, {auth: {username: this.username, password: this.password}, params: PARAMS})
                                .then((response)=>{
                                    try {
                                        if (response.data.successful === true) {
                                            adapter.setState('error.code', { val: 0, ack: true });
                                            adapter.setState('error.message', { val: 'no error', ack: true });
                                        } else {
                                            this.doErrorHandling(response.data);
                                        }
                                    }
                                    catch (errorMessage) {
                                        this.doErrorHandling(errorMessage);
                                    }
                                })
                                .catch((err)=>{
                                    adapter.log.error(`updateErrorClearReset(Reset): ${err}`);
                                });
                        }
                    } else {
                        this.doErrorHandling(response.data);
                    }
                }
                catch (errorMessage) {
                    this.doErrorHandling(errorMessage);
                }
            })
            .catch((err)=>{
                adapter.log.error(`updateErrorClearReset: ${err}`);
            });
    }

    /**
     * Update extension status
     * @param {string} ext
     * @param {*} status
     */
    updateExtensionStatus(ext, status) {
        const adapter = this;
        const PARAMS = {cmd:'ext'};
        if (status) {
            PARAMS[ext]=1;
        } else {
            PARAMS[ext]=0;
        }
        axios.interceptors.request.use(function(config){
            adapter.log.debug(JSON.stringify(config));return config;
        }, function(error) {
            return Promise.reject(error);
        });
        axios.get(adapter.apiUrl, {auth: {username: this.username, password: this.password}, params:PARAMS })
            .then((response)=>{
                try {
                    if (response.data.successful === true) {
                        adapter.setState('extension.gpio1.inverted', { val: response.data['ext']['gpio1']['inverted'], ack: true });
                        adapter.setState('extension.gpio1.status',   { val: response.data['ext']['gpio1']['status'], ack: true });
                        adapter.setState('extension.gpio2.inverted', { val: response.data['ext']['gpio2']['inverted'], ack: true });
                        adapter.setState('extension.gpio2.status',   { val: response.data['ext']['gpio2']['status'], ack: true });
                        adapter.setState('extension.out1.inverted',  { val: response.data['ext']['out1']['inverted'], ack: true });
                        adapter.setState('extension.out1.status',    { val: response.data['ext']['out1']['status'], ack: true });
                        adapter.setState('extension.out2.inverted',  { val: response.data['ext']['out2']['inverted'], ack: true });
                        adapter.setState('extension.out2.status',    { val: response.data['ext']['out2']['status'], ack: true });
                        this.log.debug(`updateExtensionStatus: Response: ${JSON.stringify(response.data)}`);
                        if (response.data['ext'][ext]['status'] === status) {
                            adapter.log.info(ext + ' set to ' + status);
                        } else {
                            this.log.error(ext + ' could not be set to ' + status + '. Is the extension mode set to API?');
                        }
                    } else {
                        this.doErrorHandling(response.data);
                    }
                }
                catch (errorMessage) {
                    this.doErrorHandling(errorMessage);
                }
            })
            .catch((err)=>{
                adapter.log.error(`updateExtensionStatus: ${err}`);
            });
    }

    /**
     * Update mode
     * @param {*} mode
     */
    updateMode(mode) {
        const adapter = this;
        const PARAMS = {cmd: 'mode', mode:'auto'};
        switch (mode) {
            case 0:
                //PARAMS.mode = 'auto';
                break;
            case 1:
                PARAMS.mode = 'man';
                break;
            case 2:
                PARAMS.mode = 'home';
                break;
            case 98:
                PARAMS.mode = 'eod';
                break;
            case 99:
                PARAMS.mode = 'job';
                break;
            default:
                this.log.warn('Mode is invalid');
                return;
        }
        axios.get(adapter.apiUrl, {auth: {username: this.username, password: this.password}, params: PARAMS})
            .then((response) => {
                try {
                    if (response.data.successful === true) {
                        adapter.setState('status.mode', { val: mode, ack: true });
                        adapter.log.info('Mode set to ' + PARAMS.mode);
                    } else {
                        this.doErrorHandling(response.data);
                    }
                }
                catch (errorMessage) {
                    this.doErrorHandling(errorMessage);
                }
            } )
            .catch( (err) => {
                this.doErrorHandling(err);
            });
    }


    /**
     * Check if current time is in a rest period
     */
    isRestTime() {
        const now = this.formatDate(new Date(), 'hh:mm');

        if (this.restPeriod1Start !== '') {
            if (this.isBetweenTimes(now, this.restPeriod1Start, this.restPeriod1End) === true)
                return true;
        }

        if (this.restPeriod2Start !== '') {
            if (this.isBetweenTimes(now, this.restPeriod2Start, this.restPeriod2End) === true)
                return true;
        }

        return false;
    }

    /**
     * Check if time is between two others
     * @param {*} testTime
     * @param {*} startTime
     * @param {*} endTime
     */
    isBetweenTimes(testTime, startTime, endTime) {
        const [testHour, testMinute] = testTime.split(':');
        const [startHour, startMinute] = startTime.split(':');
        const [endHour, endMinute] = endTime.split(':');

        const test = parseInt(testHour) * 60 + parseInt(testMinute);
        const start = parseInt(startHour) * 60 + parseInt(startMinute);
        const end = parseInt(endHour) * 60 + parseInt(endMinute);

        if (start <= end) {
            // Both times are at the same day
            if (start <= test && test <= end)
                return true;
        } else {
            // End time is (after) midnight
            if (end <= test && test >= start)
                return true;
        }

        return false;
    }

    /**
     * Check for valid time format
     * @param {*} time
     */
    isValidTimeFormat(time) {
        const timeReg = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
        return timeReg.test(time);
    }

    /**
     * Update objects
     * @param {*} objects
     * @param {*} data
     */
    updateObjects(objects, data) {
        for (const item in objects) {
            const itemValue = objects[item].value;

            let rule = itemValue;
            if (typeof (itemValue) === 'string') {
                rule = { 'var': [itemValue] };
            }

            let val = jsonLogic.apply(
                rule,
                data
            );
            if (objects[item].common.type === 'number') val=Number.parseFloat(val);
            this.setState(item, { val: val, ack: true });
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Robonect(options);
} else {
    // otherwise start the instance directly
    new Robonect();
}