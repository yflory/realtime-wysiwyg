#set($wiki = "$!request.getParameter('wiki')")
#set($space = "$!request.getParameter('space')")
#set($page = "$!request.getParameter('page')")
#set($method = "$request.getMethod()")
#if($wiki == "" || $space == "" || $page == "" || $method != "POST")
    {"error":"wiki: $wiki, space: $space, page: $page, method: $method"}
#else
    #set($ref = $services.model.createDocumentReference($wiki, $space, $page))
    {"key":"$!services.websocket.getDocumentKey($ref)", "error": "none"}
#end
