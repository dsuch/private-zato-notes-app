cmake_minimum_required(VERSION 3.22)
project(NotesApp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CMAKE_AUTOMOC ON)

set(_NOTES_MSG_LEVEL "${CMAKE_MESSAGE_LOG_LEVEL}")
set(CMAKE_MESSAGE_LOG_LEVEL WARNING)
find_package(Qt6 6.4 REQUIRED COMPONENTS Widgets)
set(CMAKE_MESSAGE_LOG_LEVEL "${_NOTES_MSG_LEVEL}")
find_package(PkgConfig QUIET)
pkg_check_modules(QSCI_PC QUIET IMPORTED_TARGET qscintilla2_qt6)

if(QSCI_PC_FOUND)
    set(NOTES_QSCI_TARGET PkgConfig::QSCI_PC)
else()
    find_path(_NOTES_QSCI_INC Qsci/qsciscintilla.h
        PATHS
        /usr/include/x86_64-linux-gnu/qt6
        /usr/include/qt6
        /usr/local/include/qt6)
    find_library(_NOTES_QSCI_LIB NAMES qscintilla2_qt6)
    if(NOT _NOTES_QSCI_INC OR NOT _NOTES_QSCI_LIB)
        message(FATAL_ERROR "Install libqscintilla2-qt6-dev (provides qscintilla2_qt6)")
    endif()
    add_library(notes_qsci INTERFACE IMPORTED)
    target_include_directories(notes_qsci INTERFACE "${_NOTES_QSCI_INC}")
    target_link_libraries(notes_qsci INTERFACE "${_NOTES_QSCI_LIB}")
    set(NOTES_QSCI_TARGET notes_qsci)
endif()

add_executable(notes-app
    src/main.cpp
    src/NoteRowDelegate.cpp
    src/MainWindow.cpp
    src/MainWindow_setup.cpp
    src/MainWindow_edit.cpp
    src/MainWindow_files.cpp
    src/MainWindow_git.cpp
    src/MainWindow_recent.cpp
    src/MainWindow_zoom.cpp
    src/MainWindow_persist.cpp
)

target_sources(notes-app PRIVATE
    src/MainWindow.h
    src/NoteRowDelegate.h
)

target_link_libraries(notes-app PRIVATE
    Qt6::Widgets
    ${NOTES_QSCI_TARGET}
)

target_compile_options(notes-app PRIVATE
    -Wall
    -Wextra
    -Werror
)
