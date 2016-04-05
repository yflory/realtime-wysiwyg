require(['jquery'], function (jQuery) {
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
        wikiSessionInProgress: "A Realtime <strong>Wiki</strong> Editor session is in progress:",
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
        RTWysiwyg_WebHome_sharejs_textarea: "$doc.getAttachmentURL('sharejs_textarea.js')",

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

    // paranoid handling of velocity Booleans values
    var RTWIKI_IS_INSTALLED = "$xwiki.getDocument('RTWiki.WebHome').isNew()" === "true"? false: true;
    // get the url
    var CHANNEL_KEY_URL = "$xwiki.getURL('RTWysiwyg.GetKey','jsx')";

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

    // used to insert some additional text before the lock link, if it exists
    var prependLink = function (link, text) {
        var p = document.createElement('p');
        p.innerHTML = text;
        link.parentElement.insertBefore(p, link);
    };

    var parseQuery = function (query) {
        var dict = {};
        query.slice(1).split("&").forEach(function (assign) {
            assign.replace(/^([^=]+)=(.*)$/, function (all, key, val) {
                dict[key] = val;
            });
        });
        return dict;
    };

    var formatQuery = function (dict) {
        return '?' + Object.keys(dict).map(function (prop) {
            return dict[prop]? prop + '=' + dict[prop]: '';
        }).join('&');
    };

    /*  modifies the lock link href, and prepends a message informing the user
        that they will be directed to an RTWYSIWYG session */
    var pointToRTWysiwyg = function (link) {
        console.log("Directing user to RYWysiwyg");
        var href = link.getAttribute('href');

        console.log("href was %s", href);

        var query;

        href = href.replace(/\?.*$/, function (q) {
            query = parseQuery(q);
            return '';
        });

        query.editor = 'inline';
        query.sheet = 'CKEditor.EditSheet';
        query.force = 1;

        href += formatQuery(query);

        console.log("href is now %s", href);
        link.setAttribute('href', href);

        prependLink(link, MESSAGES.wysiwygSessionInProgress);

        link.innerText = MESSAGES.joinSession;
    };

    /*  modifies the lock link href and prepends a message informing the user
        that they will be directed to an RTWiki session */
    var pointToRTWiki = function (link) {
        console.log("Directing user to RTWiki");

        var query;
        var href = link.getAttribute('href');

        console.log("href was %s", href);

        href = href.replace(/\?.*$/, function (q){
            query = parseQuery(q);
            return '';
        });

        query.editor = 'wiki';
        query.sheet = '';
        query.force = 1;

        href += formatQuery(query);

        console.log("href is now %s", href);
        link.setAttribute('href', href);

        /*  RTWiki will take care of pointing to the RTWiki session
            but you should add some text describing what's going on */
        prependLink(link, MESSAGES.wikiSessionInProgress);
    };

    /* Find the language of the document from the content of the page */
    var getLanguage = function () {
        /* used to use 'form#edit' but there were cases where that failed */
        var lang = jQuery('form input[type="hidden"][name="language"]').attr('value') ||
            jQuery('html').attr('lang');
        if (lang === '' || lang === 'default') {
            lang = DEFAULT_LANGUAGE;
        }
        return lang;
    };

    /*  formats an object for use by 'checkSocket()'
        accepts values which can be used to override internal values (FFU) */
    var makeConfig = function (override) {
        var language = getLanguage();

        // Username === <USER>-encoded(<PRETTY_USER>)%2d<random number>
        var userName = USER + '-' + encodeURIComponent(PRETTY_USER + '-').replace(/-/g, '%2d') +
            String(Math.random()).substring(2);

        // you MUST provide a channel to join
        if (!(override && override.channel)) {
            throw new Error('[makeConfig] undefined channel');
        }

        return {
            websocketURL: WEBSOCKET_URL,
            userName: userName,
            language: language,
            channel: override.channel
        };
    };

    /*  formats a string for use as the unique identifier of a WYSIWYG channel */
    var makeWysiwygChannel = function (key, language) {
        if (!key) {
            throw new Error('[makeWysiwygChannel] undefined key');
        }
        return JSON.stringify([
            key,
            language,
            'rtwysiwyg'
        ]);
    };

    /* format a string for use as the unique identifier of an RTWiki channel */
    var makeWikiChannel = function (key) {
        // choke if no key was provided
        if (!key) {
            throw new Error('[makeWikiChannel] undefined key');
        }
        var lang = getLanguage();
        var channel = key + lang + '-rtwiki';
        return channel;
    };

    /* asynchronous
        loads jQuery, fetches unique identifier for a channel, logs errors
        calls supplied callback with (error, key) */
    var getChannelKey = function (callback) {
        var wiki = encodeURIComponent(XWiki.currentWiki);
        var space = encodeURIComponent(XWiki.currentSpace);
        var page = encodeURIComponent(XWiki.currentPage);

        var url = CHANNEL_KEY_URL + '?minify=false&wiki=' + wiki +
            '&space='+ space + '&page=' + page;

        jQuery.ajax({
            url: url,
            method: 'POST',
            dataType: 'text',
            success: function (data) {
                var parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (err) {
                    var error = {
                        error: err,
                        type: 'parse'
                    };
                    console.error(error);
                    callback(error, false);
                    return;
                }

                if (parsed.error === "none") {
                    // it worked, return the key
                    callback(null, parsed.key);
                } else {
                    console.error("Error fetching RTWiki channel key");

                    var error = {
                        error: parsed.error,
                        type: 'velocity'
                    };

                    callback(error, false);
                }
            },
            error: function (xhr, code, error) {
                var error = {
                    error: error,
                    type: 'ajax'
                };
                callback(error, false);
            }
        });
    };

    /*  accepts a configuration object as produced by 'makeConfig(key)'
        checks whether the relevant channel has any users, executes callback
        with a boolean representing whether the channel is 'active' */
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

    /*  launches a realtime CKEditor session using a secret key */
    var launchRealtime = function (key) {
        var language = getLanguage();
        var channel = makeWysiwygChannel(key, language);
        var config = makeConfig({channel: channel});

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

    /*  check localstorage to see whether realtime wysiwyg is allowed */
    var realtimeDisallowed = function () {
        return localStorage.getItem(LOCALSTORAGE_DISALLOW)? true: false;
    };

    /*  lock is caught in several closures below.
        the lock link in the page which we'll want to transform in order to
        redirect into a realtime session */
    var lock = getDocLock();

    /*  this is the code which directs users to the CKEditor RT session
        encapsulatee to require no arguments so that it's easier to use
        since we may want to call it in many branches of the following
        conditions. */
    var checkWysiwygSocket = function (key) {
        var language = getLanguage();
        var channel = makeWysiwygChannel(key, language);
        var config = makeConfig({channel: channel});

        console.log("Checking Wysyiwyg socket");
        checkSocket(config, function (active) {
            // determine if it's a realtime session
            if (active) {
                // somebody is editing this document in a CKEditor realtime
                if (realtimeDisallowed()) {
                    console.log("Realtime disallowed, aborting...");
                    // but the user has disallowed realtime in the past
                    // they can still override the lock and edit the doc
                    // but don't start a session
                } else {
                    // the user has not disallowed realtime editing
                    // update the lock link to direct them to the session
                    pointToRTWysiwyg(lock);
                }
            } else {
                // Somebody is editing the document, but they aren't using
                // RTWiki OR RTWYSIWYG. Just leave the link as it is.
                console.log("Couldn't find an active realtime session");
            }
        });
    };

    /*  checkWikiSocket takes a key and determines whether an rtwiki session
        is active. If so, modifies the lock link such that it will direct the
        user into that session. If no RTWiki session is found, it will check
        for an RTWysiwyg session and direct the user into that if it exists. */
    var checkWikiSocket = function (key) {
        var channel = makeWikiChannel(key);

        // override the default channel (for WYSIWYG) using an RTWiki key
        var RTWiki_config = makeConfig({
            channel: channel
        });

        // see if anyone else is in that session
        checkSocket(RTWiki_config, function (active) {
            if (active) {
                // you found somebody using it, direct users to RTWiki
                pointToRTWiki(lock);
            } else {
                // there's no RTWiki session, push people to use CKE
                checkWysiwygSocket(key);
            }
        });
    };

    console.log("getting channel key");

    /*  this call begins the actual logic which determines which session to
        initialize.

        get the channel key
        is the document locked?
          YES -> is RTWiki installed?
            YES -> is the RTWiki Channel active?
              YES -> redirect to RTWiki session
              NO  -> are you using CKEditor?
                YES -> is the RTWysiwyg channel active?
                  YES -> redirect to RTWysiwyg session
                  NO -> fall through to default behaviour
                NO -> fall through to default behaviour
          NO  -> are you using CKEditor?
            YES -> is the RTWysiwyg channel active?
              YES -> redirect to RTWysiwyg session
              NO -> fall through to default behaviour
            NO -> fall through to default behaviour
    */
    getChannelKey(function (error, key) {
        if (error || !key) {
            throw new Error('[getChannelKey] failed to return key');
        }
        /* if you're here there were no errors */
        console.log("got channel key");

        // is the document locked?
        if (lock) {
            console.log("Document was locked");

            // is RTWiki installed?
            if (RTWIKI_IS_INSTALLED) {
                console.log("RTWiki is installed");

                // check if the Wiki socket has any other users
                checkWikiSocket(key);
            } else if (usingCK()) {
                console.log("Using CKEditor");

                // RTWiki is not installed, jump right into testing for CK
                checkWysiwygSocket(key);
            } else {
                console.log("Not using CKEditor");
                // RTWiki is not installed and you aren't using CKEditor, do nothing
            }
        } else if (usingCK()) {
            // Document is unlocked, we're using CKEditor and realtime is allowed:
            // start the realtime
            console.log("Launching Realtime");
            launchRealtime(key);
        } else {
            // you aren't using CKEditor, do nothing
            console.log("Document is not locked, not using CKEditor");
        }
    });
});
