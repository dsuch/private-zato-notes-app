#include "MainWindow.h"

#include <QDir>
#include <QFile>
#include <QFileDialog>
#include <QFileInfo>
#include <QListWidget>

void MainWindow::onNewNote() {
    flushSave();
    const QString name = QStringLiteral("Untitled-%1.md").arg(untitledSeq_++);
    const QString fp = QDir(notesDir()).absoluteFilePath(name);
    QFile f(fp);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text))
        return;
    f.close();
    refreshNoteList();
    if (pathToItem_.contains(fp))
        list_->setCurrentItem(pathToItem_.value(fp));
}

void MainWindow::onOpenFile() {
    const QString path = QFileDialog::getOpenFileName(this, QStringLiteral("Open note"), QString(),
                                                      QStringLiteral("All files (*)"));
    if (path.isEmpty())
        return;
    flushSave();
    const QString nd = notesDir() + QLatin1Char('/');
    if (!path.startsWith(nd))
        externalPaths_.insert(path);
    refreshNoteList();
    if (pathToItem_.contains(path))
        list_->setCurrentItem(pathToItem_.value(path));
    else
        openPath(path);
}

void MainWindow::onCloseNote() {
    if (currentPath_.isEmpty())
        return;
    flushSave();
    const QString p = currentPath_;
    registerClosedForReopen(p);
    const QString nd = notesDir() + QLatin1Char('/');
    if (!p.startsWith(nd))
        externalPaths_.remove(p);
    currentPath_.clear();
    list_->clearSelection();
    setBothEditorsText(QString());
    refreshNoteList();
    persistStateSoon();
}

void MainWindow::onCycleFile(int delta) {
    const int n = list_->count();
    if (n <= 0)
        return;
    int row = list_->currentRow();
    if (row < 0)
        row = 0;
    row = ((row + delta) % n + n) % n;
    list_->setCurrentRow(row);
}
