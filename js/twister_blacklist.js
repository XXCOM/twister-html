// twister_blacklist.js
// 2014 (null)
//
// Manage list of ignored users(blacklist). Load/Save to localstorage and DHT.
//

var blacklistUsers = [];
var _isBlacklistPublic = {};
var _blacklistPerPage = 200;
var _maxBlacklistPages = 50;
var _blacklistSeqNum = 0;
var _lastLoadFromDhtTime = 0;

var TwisterBlacklist = function (user) {
    if (!(this instanceof TwisterBlacklist))
        return new TwisterBlacklist(user);

    this.init(user);
};

TwisterBlacklist.minUpdateInterval = 43200;  // 1/2 day
TwisterBlacklist.maxUpdateInterval = 691200; // 8 days

// load blacklistUsers from localStorage
function loadBlacklistFromStorage() {
    var ns=$.initNamespaceStorage(defaultScreenName);
    if( ns.localStorage.isSet("blacklistUsers") )
        blacklistUsers = ns.localStorage.get("blacklistUsers");
    if( ns.localStorage.isSet("_isBlacklistPublic") )
        _isBlacklistPublic = ns.localStorage.get("_isBlacklistPublic");
    if( ns.localStorage.get("_blacklistSeqNum") > _blacklistSeqNum)
        _blacklistSeqNum = ns.localStorage.get("_blacklistSeqNum");
    if( ns.localStorage.isSet("lastLoadFromDhtTime") )
        _lastLoadFromDhtTime = ns.localStorage.get("lastLoadFromDhtTime");
}

// save blacklist to localStorage
function saveBlacklistToStorage() {
    var ns=$.initNamespaceStorage(defaultScreenName);
    ns.localStorage.set("blacklistUsers", blacklistUsers);
    ns.localStorage.set("_isBlacklistPublic", _isBlacklistPublic);
    ns.localStorage.set("_blacklistSeqNum", _blacklistSeqNum);
    ns.localStorage.set("lastLoadFromDhtTime", _lastLoadFromDhtTime);
}

// load public blacklist from dht resources
// "blacklist1", "blacklist2" etc.
// it will stop loading when resource is empty
// callback is called as: doneCb(doneArg, blacklist, seqNum)
function loadBlacklistFromDht(username, pageNumber, blacklist, seqNum, doneCb, doneArg) {
    if( !pageNumber ) pageNumber = 1;

    dhtget( username, "blacklist" + pageNumber, "s",
           function(args, blacklist, rawdata) {
               if( rawdata ) {
                   var seq = parseInt(rawdata[0]["p"]["seq"]);
                   if( seq > args.seqNum ) args.seqNum = seq;
               }

               if( blacklist ) {
                   for( var i = 0; i < blacklist.length; i++ ) {
                       if( args.blacklist.indexOf(blacklist[i]) < 0 ) {
                           args.blacklist.push(blacklist[i]);
                       }
                    }
               }

               if( blacklist && blacklist.length && args.pageNumber < _maxBlacklistPages) {
                   loadBlacklistFromDht(username, args.pageNumber,
                                        args.blacklist, args.seqNum,
                                        args.doneCb, args.doneArg);
               } else {
                   if( args.doneCb )
                       args.doneCb(args.doneArg, args.blacklist, args.seqNum);
               }
           }, {pageNumber:pageNumber+1, blacklist:blacklist, seqNum:seqNum,
               doneCb:doneCb, doneArg:doneArg});
}

// get number of blacklist from dht and set item.text()
function getNumBlacklist( username, item ) {
    loadBlacklistFromDht( username, 1, [], 0,
                          function(args, blacklist, seqNum) {
                             item.text( blacklist.length );
                         }, null);
}

// load blacklist from localStorage and then from the dht resource
function loadBlacklist(cbFunc, cbArg) {
    loadBlacklistFromStorage();
    updateBlacklist();

    var curTime = new Date().getTime() / 1000;

    // Warning: need optimization to avoid costly dht lookup everytime the home is loaded
    if( curTime > _lastLoadFromDhtTime) {
        var numIgnored = blacklistUsers.length;

        loadBlacklistFromDht( defaultScreenName, 1, [], _blacklistSeqNum,
                              function(args, blacklist, seqNum) {
                                 var curTime = new Date().getTime() / 1000;
                                 _lastLoadFromDhtTime = curTime;
                                 for( var i = 0; i < blacklist.length; i++ ) {
                                     if( blacklistUsers.indexOf(blacklist[i]) < 0 ) {
                                         blacklistUsers.push(blacklist[i]);
                                     }

                                     _isBlacklistPublic[blacklist[i]] = true;
                                  }

                                 if( args.numIgnored != blacklistUsers.length ||
                                     seqNum != _isBlacklistPublic ) {
                                     _blacklistSeqNum = seqNum;
                                     // new blacklist loaded from dht
                                     saveBlacklistToStorage();
                                     updateBlacklist();
                                 }

                                 if( args.cbFunc )
                                     args.cbFunc(args.cbArg);
                             }, {numIgnored:numIgnored, cbFunc:cbFunc, cbArg:cbArg} );
    } else {
        if( cbFunc )
            cbFunc(cbArg);
    }
}

// save blacklist to dht resource. each page ("blacklist1", blacklist2"...)
// constains up to _blacklistPerPage elements. 
function saveBlacklistToDht() {
    var blacklist = [];
    var pageNumber = 1;
    for( var i = 0; i < blacklistUsers.length; i++ ) {
        if( blacklistUsers[i] in _isBlacklistPublic &&
            _isBlacklistPublic[blacklistUsers[i]] ) {
            blacklist.push(blacklistUsers[i]);
        }
        if( blacklist.length == _blacklistPerPage || i == blacklistUsers.length-1) {
            dhtput( defaultScreenName, "blacklist" + pageNumber, "s",
                   blacklist, defaultScreenName, _blacklistSeqNum+1 );
            pageNumber++;
            blacklist = [];
        }
    }
    dhtput( defaultScreenName, "blacklist" + pageNumber, "s",
           blacklist, defaultScreenName, _blacklistSeqNum+1 );

    _blacklistSeqNum++;
}

// save blacklist to local storage, dht and json rpc
function saveBlacklist(cbFunc, cbArg) {
    saveBlacklistToDht();
    saveBlacklistToStorage();
    updateBlacklist(cbFunc, cbArg);
}

// update json rpc with current blacklist
function updateBlacklist(cbFunc, cbArg) {
    twisterRpc("ignore", [defaultScreenName,blacklistUsers],
               function(args, ret) {
                   if( args.cbFunc )
                       args.cbFunc(args.cbArg, true);
               }, {cbFunc:cbFunc, cbArg:cbArg},
               function(args, ret) {
                   console.log("ajax error:" + ret);
                   if( args.cbFunc )
                       args.cbFunc(args.cbArg, false);
               }, cbArg);
}

// ignore a new single user.
// it is safe to call this even if username is already in blacklistUsers.
// may also be used to set/clear publicIgnore.
function ignore(user, publicIgnore, cbFunc, cbArg) {
    if( blacklistUsers.indexOf(user) < 0 ) {
        blacklistUsers.push(user);
    }
    if( publicIgnore == undefined || publicIgnore )
        _isBlacklistPublic[user] = true;
    else
        delete _isBlacklistPublic[user];

    saveBlacklist(cbFunc, cbArg);
}

// unignore a single user
function unignore(user, cbFunc, cbArg) {
    var i = blacklistUsers.indexOf(user);
    if( i >= 0 ) {
        blacklistUsers.splice(i,1);
    }
    delete _isBlacklistPublic[user];
    saveBlacklist();

    twisterRpc("unignore", [defaultScreenName,[user]],
               function(args, ret) {
                   if( args.cbFunc )
                       args.cbFunc(args.cbArg, true);
               }, {cbFunc:cbFunc, cbArg:cbArg},
               function(args, ret) {
                   console.log("ajax error:" + ret);
                   if( args.cbFunc )
                       args.cbFunc(args.cbArg, false);
               }, {cbFunc:cbFunc, cbArg:cbArg});
}

// check if public ignoring
function isPublicIgnoring(user) {
    if( blacklistUsers.indexOf(user) < 0 ) {
        return false;
    }
    if( (user in _isBlacklistPublic) && _isBlacklistPublic[user] == true )
        return true;
    else
        return false;
}

function blacklistChangedUser() {
    blacklistUsers = [];
    _isBlacklistPublic = {};
    _blacklistSeqNum = 0;
    _lastLoadFromDhtTime = 0;
}
