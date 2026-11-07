/* What the window may ask the main process for. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, callback) => { const handler = (event, ...args) => callback(...args); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); };

contextBridge.exposeInMainWorld('lanecast', {
    info: () => invoke('app:info'),
    serial: {
        list: () => invoke('serial:list'),
        open: (role, path) => invoke('serial:open', role, path),
        close: role => invoke('serial:close', role),
        state: role => invoke('serial:state', role),
        onData: callback => on('serial:data', callback),
        onState: callback => on('serial:state', callback)
    },
    sim: {
        state: () => invoke('sim:state'),
        set: on => invoke('sim:set', on),
        control: (event, heat) => invoke('sim:control', event, heat),
        race: on => invoke('sim:race', on),
        onChange: callback => on('sim:changed', callback)
    },
    relay: {
        status: () => invoke('relay:status'),
        send: text => ipcRenderer.send('relay:send', text),
        onStatus: callback => on('relay:status', callback)
    },
    cameras: {
        status: () => invoke('cameras:status'),
        list: () => invoke('cameras:list'),
        add: camera => invoke('cameras:add', camera),
        remove: id => invoke('cameras:remove', id),
        onStatus: callback => on('cameras:status', callback)
    },
    store: {
        get: key => invoke('store:get', key),
        set: (key, value) => invoke('store:set', key, value)
    },
    files: {
        loadStartLists: () => invoke('files:loadStartLists'),
        saveStartLists: files => invoke('files:saveStartLists', files)
    }
});
