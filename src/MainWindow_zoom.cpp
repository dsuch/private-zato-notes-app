#include "MainWindow.h"

#include <QApplication>
#include <QCloseEvent>
#include <QEvent>
#include <QFontInfo>
#include <Qsci/qsciscintilla.h>
#include <QTextEdit>
#include <QWheelEvent>

static double resolvedPointSize(const QFont &f) {
    double pt = f.pointSizeF();
    if (pt > 0)
        return pt;
    const QFontInfo fi(f);
    pt = fi.pointSizeF();
    if (pt > 0)
        return pt;
    return 10.0;
}

void MainWindow::applyAppZoom() {
    const double basePt = resolvedPointSize(baseAppFont_);
    QFont f = baseAppFont_;
    f.setPointSizeF(basePt * appZoom_);
    QApplication::setFont(f);
    applyEditorFontSize();
}

void MainWindow::applyEditorFontSize() {
    QFont fe;
    fe.setPointSizeF(editorPointSize_ * appZoom_);
    if (sourceEditor_)
        sourceEditor_->setFont(fe);
    if (richEditor_)
        richEditor_->setFont(fe);
}

bool MainWindow::eventFilter(QObject *watched, QEvent *event) {
    if (event->type() == QEvent::Wheel) {
        auto *we = static_cast<QWheelEvent *>(event);
        if (we->modifiers() & Qt::ControlModifier) {
            const bool srcVp = sourceEditor_ && watched == sourceEditor_->viewport();
            const bool richVp = richEditor_ && watched == richEditor_->viewport();
            if (srcVp || richVp) {
                const double step = (we->angleDelta().y() > 0) ? 0.5 : -0.5;
                editorPointSize_ += step;
                if (editorPointSize_ < 0.25)
                    editorPointSize_ = 0.25;
                applyEditorFontSize();
                persistStateSoon();
                return true;
            }
        }
    }
    return QMainWindow::eventFilter(watched, event);
}

void MainWindow::closeEvent(QCloseEvent *event) {
    flushSave();
    saveRecentClosed();
    saveUiState();
    QMainWindow::closeEvent(event);
}
