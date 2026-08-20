; Reset the default install location after a real uninstall.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKLM "${MANUPRODUCTKEY}"
  ${EndIf}
!macroend
