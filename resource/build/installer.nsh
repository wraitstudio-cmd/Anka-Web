!macro customInstall
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser" "" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegDWORD SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\InstallInfo" "IconsVisible" 1
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities" "ApplicationDescription" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\URLAssociations" "http" "AnkaBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\URLAssociations" "https" "AnkaBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".htm" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".html" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".shtml" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".xhtml" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".pdf" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".svg" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities\FileAssociations" ".webp" "AnkaBrowserHTML"
  WriteRegStr SHCTX "Software\RegisteredApplications" "AnkaBrowser" "Software\Clients\StartMenuInternet\AnkaBrowser\Capabilities"
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserURL" "" "${PRODUCT_NAME} URL"
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserHTML" "" "${PRODUCT_NAME} Belgesi"
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserHTML\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\AnkaBrowserHTML\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "AnkaBrowser"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\AnkaBrowser"
  DeleteRegKey SHCTX "Software\Classes\AnkaBrowserURL"
  DeleteRegKey SHCTX "Software\Classes\AnkaBrowserHTML"
!macroend