#include "MainWindow.h"

#include <QApplication>
#include <QFont>
#include <QStyleFactory>

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("Notes App"));
    app.setOrganizationName(QStringLiteral("NotesApp"));

    QFont base = app.font();
    if (base.pointSizeF() <= 0)
        base.setPointSizeF(10.0);
    app.setFont(base);
    app.setStyle(QStyleFactory::create(QStringLiteral("Fusion")));

    MainWindow w;
    w.show();
    return app.exec();
}
