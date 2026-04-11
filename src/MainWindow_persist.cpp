#include "MainWindow.h"

#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QListWidget>
#include <QPushButton>
#include <QResizeEvent>
#include <QSplitter>
#include <QStackedWidget>
#include <QTextEdit>
#include <Qsci/qsciscintilla.h>

void MainWindow::loadUiState() {
    QFile f(stateFilePath());
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text))
        return;
    QJsonParseError pe{};
    const QJsonDocument doc = QJsonDocument::fromJson(f.readAll(), &pe);
    if (pe.error != QJsonParseError::NoError || !doc.isObject())
        return;
    const QJsonObject root = doc.object();

    appZoom_ = root.value(QStringLiteral("appZoom")).toDouble(1.0);
    if (appZoom_ < 1e-9)
        appZoom_ = 1e-9;
    editorPointSize_ = root.value(QStringLiteral("editorFontPt")).toDouble(editorPointSize_);
    baseEditorPointSizeSaved_ = root.value(QStringLiteral("baseEditorFontPt")).toDouble(editorPointSize_);

    wysiwygMode_ = root.value(QStringLiteral("wysiwyg")).toBool(false);
    if (wysiwygBtn_) {
        wysiwygBtn_->blockSignals(true);
        wysiwygBtn_->setChecked(wysiwygMode_);
        wysiwygBtn_->blockSignals(false);
    }
    if (editorStack_ && sourceEditor_ && richEditor_) {
        if (wysiwygMode_)
            editorStack_->setCurrentWidget(richEditor_);
        else
            editorStack_->setCurrentWidget(sourceEditor_);
    }

    notesSidebarVisible_ = root.value(QStringLiteral("notesSidebarVisible")).toBool(true);
    savedNotesSidebarWidth_ = root.value(QStringLiteral("splitListWidth")).toInt(220);

    const QJsonObject cj = root.value(QStringLiteral("cursorByFile")).toObject();
    for (auto it = cj.constBegin(); it != cj.constEnd(); ++it) {
        const QString abs = QDir(repoRoot_).absoluteFilePath(it.key());
        if (!it.value().isObject())
            continue;
        cursorByFile_.insert(abs, it.value().toObject());
    }

    pendingRestorePath_ = root.value(QStringLiteral("currentFile")).toString();

    const QByteArray geom = QByteArray::fromHex(root.value(QStringLiteral("geom")).toString().toLatin1());
    if (!geom.isEmpty())
        restoreGeometry(geom);
    if (root.value(QStringLiteral("maximized")).toBool(false))
        showMaximized();

    const QJsonArray spa = root.value(QStringLiteral("splitSizes")).toArray();
    if (spa.size() >= 2 && split_) {
        QList<int> sz;
        sz.reserve(spa.size());
        for (const QJsonValue &v : spa)
            sz.append(v.toInt());
        split_->setSizes(sz);
    }

    if (!notesSidebarVisible_ && list_) {
        list_->setVisible(false);
        list_->setMinimumWidth(0);
    }

}

void MainWindow::saveUiState() {
    if (!split_ || !list_)
        return;
    if (!currentPath_.isEmpty())
        cursorByFile_.insert(currentPath_, captureCursorState());

    QJsonObject root;
    root.insert(QStringLiteral("version"), 2);
    root.insert(QStringLiteral("appZoom"), appZoom_);
    root.insert(QStringLiteral("editorFontPt"), editorPointSize_);
    root.insert(QStringLiteral("baseEditorFontPt"), baseEditorPointSizeSaved_);
    root.insert(QStringLiteral("wysiwyg"), wysiwygMode_);
    root.insert(QStringLiteral("notesSidebarVisible"), notesSidebarVisible_);
    root.insert(QStringLiteral("splitListWidth"), list_->isVisible() ? list_->width() : savedNotesSidebarWidth_);
    root.insert(QStringLiteral("geom"), QString::fromLatin1(saveGeometry().toHex()));
    root.insert(QStringLiteral("maximized"), isMaximized());

    QJsonArray spa;
    for (int v : split_->sizes())
        spa.append(v);
    root.insert(QStringLiteral("splitSizes"), spa);

    if (!currentPath_.isEmpty()) {
        const QString rel = QDir(repoRoot_).relativeFilePath(currentPath_);
        if (!rel.startsWith(QStringLiteral("..")))
            root.insert(QStringLiteral("currentFile"), rel);
        else
            root.insert(QStringLiteral("currentFile"), currentPath_);
    }

    QJsonObject cj;
    for (auto it = cursorByFile_.constBegin(); it != cursorByFile_.constEnd(); ++it)
        cj.insert(QDir(repoRoot_).relativeFilePath(it.key()), it.value());
    root.insert(QStringLiteral("cursorByFile"), cj);

    QFile f(stateFilePath());
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text))
        return;
    f.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
}

void MainWindow::resizeEvent(QResizeEvent *event) {
    QMainWindow::resizeEvent(event);
    if (list_)
        list_->doItemsLayout();
    persistStateSoon();
}
