#include "MainWindow.h"

#include <QMessageBox>
#include <QProcess>

void MainWindow::onPush() {
    flushSave();
    QProcess proc;
    proc.setWorkingDirectory(repoRoot_);
    proc.setProgram(QStringLiteral("/bin/bash"));
    proc.setArguments({QStringLiteral("-lc"),
                       QStringLiteral("git add notes && (git diff --cached --quiet || git commit -m "
                                      "\"Adding latest notes.\") && git push")});
    proc.start();
    proc.waitForFinished(-1);
    if (proc.exitCode() != 0) {
        const QString err = QString::fromUtf8(proc.readAllStandardError() + proc.readAllStandardOutput());
        QMessageBox::warning(this, QStringLiteral("Push"), err.isEmpty() ? QStringLiteral("git failed") : err);
    }
}
