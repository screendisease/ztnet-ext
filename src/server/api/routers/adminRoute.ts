import { createTRPCRouter, adminRoleProtectedRoute } from "~/server/api/trpc";
import { z } from "zod";
import * as ztController from "~/utils/ztApi";
import ejs from "ejs";
import { forgotPasswordTemplate, inviteUserTemplate } from "~/utils/mail";
import { createTransporter, sendEmail } from "~/utils/mail";
import type nodemailer from "nodemailer";

export const adminRouter = createTRPCRouter({
  getUsers: adminRoleProtectedRoute.query(async ({ ctx }) => {
    const users = await ctx.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        lastLogin: true,
        lastseen: true,
        online: true,
        role: true,
        _count: {
          select: {
            network: true,
          },
        },
        // network: {
        //   select: {
        //     nwid: true,
        //     nwname: true,
        //   },
        // },
      },
    });
    return users;
  }),

  getControllerStats: adminRoleProtectedRoute.query(async () => {
    const networks = await ztController.get_controller_networks();

    const networkCount = networks.length;
    let totalMembers = 0;
    for (const network of networks) {
      const members = await ztController.network_members(network);
      totalMembers += Object.keys(members).length;
    }

    const controllerStatus = await ztController.get_controller_status();
    return {
      networkCount,
      totalMembers,
      controllerStatus,
    };
  }),

  // Set global options
  getAllOptions: adminRoleProtectedRoute.query(async ({ ctx }) => {
    return await ctx.prisma.globalOptions.findFirst({
      where: {
        id: 1,
      },
    });
  }),
  registration: adminRoleProtectedRoute
    .input(
      z.object({
        enableRegistration: z.boolean().optional(),
        firstUserRegistration: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.prisma.globalOptions.update({
        where: {
          id: 1,
        },
        data: {
          ...input,
        },
      });
    }),
  getMailTemplates: adminRoleProtectedRoute
    .input(
      z.object({
        template: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const templates = await ctx.prisma.globalOptions.findFirst({
        where: {
          id: 1,
        },
      });

      switch (input.template) {
        case "inviteUserTemplate":
          return templates?.inviteUserTemplate ?? inviteUserTemplate();
          break;
        case "forgotPasswordTemplate":
          return templates?.forgotPasswordTemplate ?? forgotPasswordTemplate();
          break;
        default:
          return {};
          break;
      }
    }),

  setMail: adminRoleProtectedRoute
    .input(
      z.object({
        smtpHost: z.string().optional(),
        smtpPort: z.string().optional(),
        smtpSecure: z.boolean().optional(),
        smtpEmail: z.string().optional(),
        smtpPassword: z.string().optional(),
        smtpUsername: z.string().optional(),
        smtpUseSSL: z.boolean().optional(),
        smtpIgnoreTLS: z.boolean().optional(),
        smtpRequireTLS: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.prisma.globalOptions.update({
        where: {
          id: 1,
        },
        data: {
          ...input,
        },
      });
    }),
  setMailTemplates: adminRoleProtectedRoute
    .input(
      z.object({
        template: z.string(),
        type: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const templateObj = JSON.parse(input.template) as string;
      switch (input.type) {
        case "inviteUserTemplate":
          return await ctx.prisma.globalOptions.update({
            where: {
              id: 1,
            },
            data: {
              inviteUserTemplate: templateObj,
            },
          });
          break;
        case "forgotPasswordTemplate":
          return await ctx.prisma.globalOptions.update({
            where: {
              id: 1,
            },
            data: {
              forgotPasswordTemplate: templateObj,
            },
          });
          break;
        default:
          break;
      }
    }),
  getDefaultMailTemplate: adminRoleProtectedRoute
    .input(
      z.object({
        template: z.string(),
      })
    )
    .mutation(({ input }) => {
      switch (input.template) {
        case "inviteUserTemplate":
          return inviteUserTemplate();
          break;
        case "forgotPasswordTemplate":
          return forgotPasswordTemplate();
          break;
        default:
          break;
      }
    }),
  sendTestMail: adminRoleProtectedRoute
    .input(
      z.object({
        type: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const globalOptions = await ctx.prisma.globalOptions.findFirst({
        where: {
          id: 1,
        },
      });

      async function sendTemplateEmail(templateName, template) {
        const renderedTemplate = await ejs.render(
          JSON.stringify(template),
          {
            toEmail: ctx.session.user.email,
            fromName: ctx.session.user.name,
            forgotLink: "https://example.com",
            nwid: "123456789",
          },
          { async: true }
        );

        const parsedTemplate = JSON.parse(renderedTemplate) as Record<
          string,
          string
        >;

        try {
          const transporter: nodemailer.Transporter =
            createTransporter(globalOptions);

          // Define mail options
          const mailOptions = {
            from: globalOptions.smtpEmail,
            to: ctx.session.user.email,
            subject: parsedTemplate.subject,
            html: parsedTemplate.body,
          };

          // Send test mail to user
          await sendEmail(transporter, mailOptions);
        } catch (error) {
          throw error;
        }
      }

      switch (input.type) {
        case "inviteUserTemplate":
          const defaultInviteTemplate = inviteUserTemplate();
          const inviteTemplate =
            globalOptions?.inviteUserTemplate ?? defaultInviteTemplate;
          await sendTemplateEmail("inviteUser", inviteTemplate);
          break;

        case "forgotPasswordTemplate":
          const defaultForgotTemplate = forgotPasswordTemplate();
          const forgotTemplate =
            globalOptions?.forgotPasswordTemplate ?? defaultForgotTemplate;
          await sendTemplateEmail("forgotPassword", forgotTemplate);
          break;

        default:
          break;
      }
    }),
});
