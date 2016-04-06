;(function() {
    // VELOCITY
    var WEBSOCKET_URL = "$!services.websocket.getURL('realtime')";
    var USER = "$!xcontext.getUserReference()" || "xwiki:XWiki.XWikiGuest";
    var PRETTY_USER = "$xwiki.getUserName($xcontext.getUser(), false)";
    var DEMO_MODE = "$!request.getParameter('demoMode')" || false;
    var DEFAULT_LANGUAGE = "$xwiki.getXWikiPreference('default_language')";
    var LOCALSTORAGE_DISALLOW = 'rtwysiwyg-disallow';
    var MESSAGES = {
        allowRealtime: "Allow Realtime Collaboration", // TODO: translate
        joinSession: "Join Realtime Collaborative Session",

        wysiwygSessionInProgress: "A Realtime <strong>WYSIWYG</strong> Editor session is in progress:",

        disconnected: "Disconnected",
        myself: "Myself",
        guest: "Guest",
        guests: "Guests",
        and: "and",
        editingWith: "Editing With:",
        debug: "Debug",
        lag: "Lag:"
    };
    var PATHS = {
        RTWysiwyg_WebHome_chainpad: "$doc.getAttachmentURL('chainpad.js')",
        RTWysiwyg_WebHome_realtime_wysiwyg: "$doc.getAttachmentURL('realtime-wysiwyg.js')",
        RTWysiwyg_WebHome_realtime_cleartext: "$doc.getAttachmentURL('realtime-cleartext.js')",

        RTWysiwyg_WebHome_toolbar: "$doc.getAttachmentURL('toolbar.js')",
        RTWysiwyg_WebHome_cursor: "$doc.getAttachmentURL('cursor.js')",
        RTWysiwyg_WebHome_json_ot: "$doc.getAttachmentURL('json-ot.js')",

        RTWysiwyg_WebHome_hyperjson: "$doc.getAttachmentURL('hyperjson.js')",
        RTWysiwyg_WebHome_hyperscript: "$doc.getAttachmentURL('hyperscript.js')",

        RTWysiwyg_WebHome_treesome: "$doc.getAttachmentURL('treesome.js')",
        RTWysiwyg_WebHome_text_patcher: "$doc.getAttachmentURL('text-patcher.js')",

        RTWysiwyg_WebHome_diffDOM: "$doc.getAttachmentURL('diffDOM.js')",

        RTWysiwyg_WebHome_messages: "$doc.getAttachmentURL('messages.js')",
        RTWysiwyg_WebHome_reconnecting_websocket: "$doc.getAttachmentURL('reconnecting-websocket.js')",

        RTWysiwyg_WebHome_rangy: "$doc.getAttachmentURL('rangy-core.min.js')",
        RTWysiwyg_ErrorBox: "$xwiki.getURL('RTWysiwyg.ErrorBox','jsx')" + '?minify=false'
    };
    #if("$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl" != "")
    var ISSUE_TRACKER_URL = "$!doc.getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #else
    #set($mainWIkiRef = $services.model.createDocumentReference($xcontext.getMainWikiName(), 'RTWysiwyg', 'WebHome'))
    var ISSUE_TRACKER_URL = "$!xwiki.getDocument($mainWIkiRef).getObject('RTWysiwyg.ConfigurationClass').issueTrackerUrl";
    #end
    // END_VELOCITY

    if (!WEBSOCKET_URL) {
        // TODO integrate this notification into the CKEditor upper panel
        console.log("The provided websocketURL was empty, aborting attempt to" +
            "configure a realtime session.");
        return;
    }

    //for (var path in PATHS) { PATHS[path] = PATHS[path].replace(/\.js$/, ''); }
    for (var path in PATHS) { PATHS[path] = PATHS[path] + '?cb='+(new Date()).getTime(); }
    require.config({paths:PATHS});

    if (!window.XWiki) {
        console.log("WARNING: XWiki js object not defined.");
        return;
    }

    // Not in edit mode?
    if (!DEMO_MODE && window.XWiki.contextaction !== 'edit') { return; }


    var getDocLock = function () {
        var force = document.querySelectorAll('a[href*="force=1"][href*="/edit/"]');
        return force.length? force[0] : false;
    };

    var usingCK = function () {
        /*  we can't rely on XWiki.editor to give an accurate response,
            nor can we expect certain scripts or stylesheets to exist

            if your document has CKEditor in its title it will have a cannonical
            link that will cause a false positive.

            http://jira.xwiki.org/browse/CKEDITOR-46 provides hooks, but these
            will not exist in older versions of XWiki.
        */
        return (/sheet=CKEditor/.test(window.location.href));
    };

    // used to insert some descriptive text before the lock link
    var prependLink = function (link, text) {
        var p = document.createElement('p');
        p.innerHTML = text;
        link.parentElement.insertBefore(p, link);
    };

    var pointToRealtime = function (link) {
        var href = link.getAttribute('href');

        href = href.replace(/\?(.*)$/, function (all, args) {
            return '?' + args.split('&').filter(function (arg) {
                if (arg === 'editor=wysiwyg') { return false; }
                if (arg === 'editor=wiki') { return false; }
                if (arg === 'sheet=CKEditor.EditSheet') { return false; }
                if (arg === 'force=1') { return false; }
            }).join('&');
        });

        href = href + '&editor=inline&sheet=CKEditor.EditSheet&force=1';
        link.setAttribute('href', href);
        link.innerText = MESSAGES.joinSession;

        prependLink(link, MESSAGES.wysiwygSessionInProgress);
    };

    var makeConfig = function () {
        var languageSelector = document.querySelectorAll('form input[name="language"]');// [0].value;

        var language = languageSelector[0] && languageSelector[0].value;

        if (!language || language === 'default') { language = DEFAULT_LANGUAGE; }

        // Username === <USER>-encoded(<PRETTY_USER>)%2d<random number>
        var userName = USER + '-' + encodeURIComponent(PRETTY_USER + '-').replace(/-/g, '%2d') +
            String(Math.random()).substring(2);

        return {
            websocketURL: WEBSOCKET_URL,
            userName: userName,
            language: language,
            channel: JSON.stringify([
                XWiki.currentWiki,
                XWiki.currentSpace,
                XWiki.currentPage,
                language,
                'rtwysiwyg'
            ])
        };
    };

    var checkSocket = function (config, callback) {
        var socket = new WebSocket(config.websocketURL);
        socket.onopen = function (evt) {
            var regMsgEnd = '3:[0]';
            socket.onmessage = function (evt) {
                if (evt.data.indexOf(regMsgEnd) !== evt.data.length - regMsgEnd.length) {
                    // not a register message (ignore it)
                } else if (evt.data.indexOf(config.userName.length + ':' + config.userName) === 0) {
                    // it's you registering
                    socket.close();
                    callback(false);
                } else {
                    socket.close();
                    callback(true);
                }
            };
            socket.send('1:x' +
                config.userName.length + ':' + config.userName +
                config.channel.length + ':' + config.channel +
                '3:[0]');
        };
    };

    var launchRealtime = function (config) {
        require(['jquery', 'RTWysiwyg_WebHome_realtime_wysiwyg'], function ($, RTWysiwyg) {
            if (RTWysiwyg && RTWysiwyg.main) {
                RTWysiwyg.main(config.websocketURL, config.userName, MESSAGES, config.channel, DEMO_MODE, config.language);
                // Begin : Add the issue tracker icon
              var untilThen = function () {
                var $iframe = $('iframe');
                if (window.CKEDITOR &&
                    window.CKEDITOR.instances &&
                    window.CKEDITOR.instances.content &&
                    $iframe.length &&
                    $iframe[0].contentWindow &&
                    $iframe[0].contentWindow.body) {
                    if(ISSUE_TRACKER_URL && ISSUE_TRACKER_URL.trim() !== '') {
                      $('#cke_1_toolbox').append('<span id="RTWysiwyg_issueTracker" class="cke_toolbar" role="toolbar"><span class="cke_toolbar_start"></span><span class="cke_toolgroup"><a href="'+ISSUE_TRACKER_URL+'" target="_blank" class="cke_button cke_button_off" title="Report a bug" tabindex="-1" hidefocus="true" role="button" aria-haspopup="false"><span style="font-family: FontAwesome;cursor:default;" class="fa fa-bug"></span></a></span><span class="cke_toolbar_end"></span></span>');
                    }
                    // CKEditor seems to create IDs dynamically, and as such
                    // you cannot rely on IDs for removing buttons after launch
                    $('.cke_button__source').remove();
                    return;
                }
                setTimeout(untilThen, 100);
              };
              /* wait for the existence of CKEDITOR before doing things...  */
              untilThen();
              // End issue tracker icon
            } else {
                console.error("Couldn't find RTWysiwyg.main, aborting");
            }
        });
    };

    var realtimeDisallowed = function () {
        return localStorage.getItem(LOCALSTORAGE_DISALLOW)?  true: false;
    };
    var lock = getDocLock();

    var config = makeConfig();
    if (lock) {
        // found a lock link

        //console.log("Found a lock on the document!");
        checkSocket(config, function (active) {
            // determine if it's a realtime session
            if (active) {
                console.log("Found an active realtime");
                if (realtimeDisallowed()) {
                    // do nothing
                } else {
                    pointToRealtime(lock);
                }
            } else {
                console.log("Couldn't find an active realtime session");
            }
        });
    } else if (usingCK()) {
        // using CKEditor and realtime is allowed: start the realtime
        launchRealtime(config);
    } else {
        // do nothing
    }
}());
