; Registers Kiroku as a Windows "Default apps" candidate (per-user, HKCU).
; electron-builder's fileAssociations macro (FileAssociation.nsh APP_ASSOCIATE) writes ProgIDs named
; exactly after each fileAssociations[].name (Kiroku.Word / .Cell / .Slide / .Pdf in package.json),
; so Capabilities\FileAssociations points .ext -> that same ProgID. registerFileAssociations runs
; before customInstall, and $appExe is set by installSection.nsh.

!macro KirokuCap EXT PROGID
  WriteRegStr HKCU "Software\Kiroku\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Kiroku\Capabilities" "ApplicationName" "Kiroku"
  WriteRegStr HKCU "Software\Kiroku\Capabilities" "ApplicationDescription" "Offline office suite: documents, spreadsheets, presentations and PDF."
  WriteRegStr HKCU "Software\Kiroku\Capabilities" "ApplicationIcon" "$appExe,0"

  !insertmacro KirokuCap "docx" "Kiroku.Word"
  !insertmacro KirokuCap "doc" "Kiroku.Word"
  !insertmacro KirokuCap "odt" "Kiroku.Word"
  !insertmacro KirokuCap "rtf" "Kiroku.Word"
  !insertmacro KirokuCap "txt" "Kiroku.Word"
  !insertmacro KirokuCap "xlsx" "Kiroku.Cell"
  !insertmacro KirokuCap "xls" "Kiroku.Cell"
  !insertmacro KirokuCap "ods" "Kiroku.Cell"
  !insertmacro KirokuCap "csv" "Kiroku.Cell"
  !insertmacro KirokuCap "pptx" "Kiroku.Slide"
  !insertmacro KirokuCap "ppt" "Kiroku.Slide"
  !insertmacro KirokuCap "odp" "Kiroku.Slide"
  !insertmacro KirokuCap "pdf" "Kiroku.Pdf"

  WriteRegStr HKCU "Software\RegisteredApplications" "Kiroku" "Software\Kiroku\Capabilities"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\RegisteredApplications" "Kiroku"
  DeleteRegKey HKCU "Software\Kiroku\Capabilities"
  DeleteRegKey /ifempty HKCU "Software\Kiroku"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
