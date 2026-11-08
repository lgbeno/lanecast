/* What the window may ask the main process for. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, callback) => { const handler = (event, ...args) => callback(...args); ipcRenderer.on(channel, handler); return () => ipcRenderer.removeListener(channel, handler); };

contextBridge.exposeInMainWorld('lanecast', {
    info: () => invoke('app:info'),
    serial: {
        list: role => invoke('serial:list', role),
        open: (role, path) => invoke('serial:open', role, path),
        close: role => invoke('serial:close', role),
        state: role => invoke('serial:state', role),
        onData: callback => on('serial:data', callback),
        onState: callback => on('serial:state', callback)
    },
    sim: {
        state: () => invoke('sim:state'),
        set: (part, on) => invoke('sim:set', part, on),
        control: (event, heat) => invoke('sim:control', event, heat),
        race: on => invoke('sim:race', on),
        run: (on, event, heat) => invoke('sim:run', on, event, heat),
        schedule: meet => invoke('sim:schedule', meet),
        onChange: callback => on('sim:changed', callback)
    },
    relay: {
        status: () => invoke('relay:status'),
        send: text => ipcRenderer.send('relay:send', text),
        onStatus: callback => on('relay:status', callback)
    },
    cameras: {
        status: () => invoke('cameras:status'),
        access: () => invoke('cameras:access'),
        list: () => invoke('cameras:list'),
        add: camera => invoke('cameras:add', camera),
        update: (id, patch) => invoke('cameras:update', id, patch),
        remove: id => invoke('cameras:remove', id),
        chooseMedia: id => invoke('cameras:chooseMedia', id),
        clearMedia: id => invoke('cameras:clearMedia', id),
        mediaBytes: id => invoke('cameras:mediaBytes', id),
        onStatus: callback => on('cameras:status', callback)
    },
    project: {
        info: () => invoke('project:info'),
        new: () => invoke('project:new'),
        open: () => invoke('project:open'),
        openPath: file => invoke('project:openPath', file),
        save: () => invoke('project:save'),
        saveAs: () => invoke('project:saveAs'),
        saveTo: file => invoke('project:saveTo', file),
        rename: name => invoke('project:rename', name),
        onChange: callback => on('project:changed', callback)
    },
    themes: {
        list: () => invoke('themes:list'),
        active: () => invoke('themes:active'),
        select: id => invoke('themes:select', id),
        create: name => invoke('themes:create', name),
        openFolder: () => invoke('themes:openFolder'),
        folder: () => invoke('themes:folder')
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
